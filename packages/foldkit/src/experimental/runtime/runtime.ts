import {
  Cause,
  Deferred,
  Effect,
  Function,
  Layer,
  Option,
  PubSub,
  type Scope,
} from 'effect'

import type { ManagedResources } from '../../managedResource/index.js'
import { RenderCommit, createCommitNotifier } from '../../render/commit.js'
import { makeExecution } from '../../runtime/execution.js'
import { forkManagedResourceFibers } from '../../runtime/managedResourceFibers.js'
import { makeMessageQueue } from '../../runtime/messageQueue.js'
import { makeResourceProvider } from '../../runtime/resourceProvider.js'
import { makeRuntimeStatus } from '../../runtime/runtimeStatus.js'
import { forkSubscriptionFibers } from '../../runtime/subscriptionFibers.js'
import type { Subscriptions } from '../../subscription/subscription.js'
import type { Return as UpdateReturn } from '../../update/index.js'

/** A host commits a Model to its render tree and schedules later commits.
 * `scheduleCommit` must call its callback asynchronously, at most once, and
 * return a cancellation function. Commit completion is not a paint signal. */
export type Host<Model> = Readonly<{
  commit: (model: Model) => void
  scheduleCommit: (commit: () => void) => () => void
}>

/** Callbacks available during host acquisition and for its entire lifetime.
 * Messages buffer until boot completes. `stop` closes the runtime scope;
 * subsequent dispatches are ignored, including those from host finalizers. */
export type Controls<Message> = Readonly<{
  dispatch: (message: Message) => void
  stop: () => void
}>

/** Experimental configuration for a non-browser runtime. The host owns its
 * view vocabulary and acquires renderer resources with scoped Effects.
 * Application Models and Messages use the same Schema-defined types as a
 * browser program. Resolve application Flags before constructing this config. */
export type Config<
  Model,
  Message,
  Resources = never,
  ManagedResourceServices = never,
> = Readonly<{
  init: () => UpdateReturn<Model, Message, Resources | ManagedResourceServices>
  update: (
    model: Model,
    message: Message,
  ) => UpdateReturn<Model, Message, Resources | ManagedResourceServices>
  host: (
    controls: Controls<Message>,
  ) => Effect.Effect<Host<Model>, never, Scope.Scope>
  subscriptions?: Subscriptions<
    Model,
    Message,
    Resources | ManagedResourceServices
  >
  resources?: Layer.Layer<Resources>
  managedResources?: ManagedResources<Model, Message, ManagedResourceServices>
}>

/** Runs a host using the browser runtime's shared Message queue, Model
 * transitions, Command executor, and resource lifecycle machinery. Interrupt
 * this Effect or call the host's `stop` callback to release the runtime.
 * An update, commit, or background defect fails this Effect and closes its
 * scope. Hosts may report that failure after their renderer is released. */
export const run = <
  Model,
  Message,
  Resources = never,
  ManagedResourceServices = never,
>(
  config: Config<Model, Message, Resources, ManagedResourceServices>,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const commitNotifier = createCommitNotifier()

    return Effect.scoped(
      Effect.gen(function* () {
        const runtimeScope = yield* Effect.scope
        const runtimeContext = yield* Effect.context<never>()
        const finished = yield* Deferred.make<void>()
        const status = makeRuntimeStatus()

        const crashWith = (cause: Cause.Cause<never>) =>
          Effect.sync(() => {
            if (
              status.isRuntimeDisposed ||
              status.isCrashed ||
              Cause.hasInterruptsOnly(cause)
            ) {
              return
            }

            status.isCrashed = true
            Deferred.doneUnsafe(finished, Effect.failCause(cause))
          })

        const stop = (): void => {
          status.isRuntimeDisposed = true
          Deferred.doneUnsafe(finished, Effect.void)
        }

        const provider = yield* makeResourceProvider({
          resources: config.resources,
          managedResources: config.managedResources,
          runtimeScope,
          maybePortChannels: Option.none(),
        })
        const init_ = config.init()
        const modelPubSub = yield* PubSub.unbounded<Model>()
        const messageQueue = yield* makeMessageQueue<Message>({
          status,
          processMessage: message => execution.processMessage(message),
          crashWith,
        })
        const host = yield* config.host({
          dispatch: messageQueue.enqueueMessage,
          stop,
        })
        let maybeCancelCommit = Option.none<() => void>()

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            status.isRuntimeDisposed = true
            if (Option.isSome(maybeCancelCommit)) {
              maybeCancelCommit.value()
            }
            commitNotifier.notifyCommitted()
          }),
        )

        const commit = (): void => {
          maybeCancelCommit = Option.none()
          if (status.isRuntimeDisposed || status.isCrashed) {
            return
          }

          status.isRenderingFrame = true
          try {
            host.commit(execution.readModel())
            commitNotifier.notifyCommitted()
          } catch (error) {
            Effect.runSync(crashWith(Cause.die(error)))
          } finally {
            status.isRenderingFrame = false
          }

          messageQueue.resetDrainBudget()
          messageQueue.drainPendingMessages()
        }

        const execution = makeExecution<
          Model,
          Message,
          Resources | ManagedResourceServices
        >({
          initModel: init_.model,
          update: config.update,
          prepareModel: Function.identity,
          maybeSlowUpdate: Option.none(),
          status,
          runtimeScope,
          runtimeContext,
          provideAllResources: provider.provideAllResources,
          enqueueMessageEffect: messageQueue.enqueueMessageEffect,
          crashWith,
          onModelChanged: model => {
            PubSub.publishUnsafe(modelPubSub, model)
            if (Option.isNone(maybeCancelCommit)) {
              commitNotifier.markCommitPending()
              maybeCancelCommit = Option.some(host.scheduleCommit(commit))
            }
          },
          recordMessage: Function.constVoid,
        })

        commit()
        if (status.isCrashed || status.isRuntimeDisposed) {
          return yield* Deferred.await(finished)
        }

        if (config.subscriptions) {
          yield* forkSubscriptionFibers<
            Model,
            Message,
            Resources | ManagedResourceServices
          >({
            subscriptions: config.subscriptions,
            initModel: init_.model,
            modelPubSub,
            runtimeScope,
            maybeSlowSubscriptionDependencies: Option.none(),
            enqueueMessageEffect: messageQueue.enqueueMessageEffect,
            provideAllResources: provider.provideAllResources,
            crashWith,
          })
        }
        yield* forkManagedResourceFibers({
          managedResourceRefs: provider.managedResourceRefs,
          initModel: init_.model,
          modelPubSub,
          runtimeScope,
          enqueueMessageEffect: messageQueue.enqueueMessageEffect,
          crashWith,
        })

        // NOTE: registered after lifecycle fibers so LIFO teardown gates their
        // release Messages before any finalizer can dispatch into update.
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            status.isRuntimeDisposed = true
          }),
        )

        execution.runCommands(init_.commands, Option.none())
        messageQueue.completeBoot()
        yield* Deferred.await(finished)
      }),
    ).pipe(Effect.provideService(RenderCommit, commitNotifier.service))
  })
