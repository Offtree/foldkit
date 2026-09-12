import { Cause, Context, Effect, Option, type Scope } from 'effect'

import type { Commands, Return as UpdateReturn } from '../update/index.js'
import type { RuntimeStatus } from './runtimeStatus.js'
import {
  type ResolvedSlowPhaseConfig,
  type SlowUpdateContext,
  measureSlowPhase,
  reportSlowPhase,
} from './slowPhase.js'

type ExecutableCommand<Message, Services> = Readonly<{
  name: string
  args?: Record<string, unknown>
  effect: Effect.Effect<Message, never, Services>
}>

/** Shared Model transitions and scoped Command execution for runtime hosts. */
export const makeExecution = <Model, Message, Services>({
  initModel,
  update,
  prepareModel,
  maybeSlowUpdate,
  status,
  runtimeScope,
  runtimeContext,
  provideAllResources,
  enqueueMessageEffect,
  crashWith,
  onModelChanged,
  recordMessage,
}: Readonly<{
  initModel: Model
  update: (
    model: Model,
    message: Message,
  ) => UpdateReturn<Model, Message, Services>
  prepareModel: (model: Model) => Model
  maybeSlowUpdate: Option.Option<
    ResolvedSlowPhaseConfig<SlowUpdateContext<Model, Message>>
  >
  status: RuntimeStatus
  runtimeScope: Scope.Scope
  runtimeContext: Context.Context<never>
  provideAllResources: <A>(
    effect: Effect.Effect<A, never, Services>,
  ) => Effect.Effect<A>
  enqueueMessageEffect: (message: Message) => Effect.Effect<void>
  crashWith: (
    cause: Cause.Cause<never>,
    message: Option.Option<Message>,
  ) => Effect.Effect<void>
  onModelChanged: (model: Model, message: Message) => void
  recordMessage: (
    message: Message,
    previousModel: Model,
    model: Model,
    commands: Commands<Message, Services>,
  ) => void
}>) => {
  let liveModel = initModel

  const runCommands = (
    commands: Commands<Message, Services> | undefined,
    message: Option.Option<Message>,
  ): void => {
    for (const command of commands ?? []) {
      // NOTE: Command accepts either a Schema or its Type. The runtime always
      // receives the Type, but the conditional public type stays unresolved
      // for a generic Message.
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
      const executable = command as ExecutableCommand<Message, Services>
      // NOTE: start outside the dispatch stack, then inherit the runtime's
      // scheduler through runForkWith. runSyncWith would inject a temporary
      // synchronous scheduler into the Command's later continuations.
      queueMicrotask(() => {
        // NOTE: gate on `isCrashed` as well as `isRuntimeDisposed`. A crash is
        // terminal but does not itself run a host teardown, so a Command
        // forked by a Message processed just before the crashing Message sits
        // in this microtask while the host still holds a failed presentation.
        // Without the check the Command would run behind that failure,
        // contradicting crash terminality. `crashWith` sets `isCrashed`
        // synchronously, so the flag is already set by the time this runs.
        if (status.isRuntimeDisposed || status.isCrashed) {
          return
        }

        Effect.runForkWith(runtimeContext)(
          Effect.forkIn(runtimeScope)(
            executable.effect.pipe(
              Effect.withSpan(executable.name, {
                attributes: executable.args ?? {},
              }),
              provideAllResources,
              Effect.flatMap(enqueueMessageEffect),
              Effect.catchCause(cause => crashWith(cause, message)),
            ),
          ),
        )
      })
    }
  }

  const processMessage = (message: Message): void => {
    const previousModel = liveModel
    const [messageUpdate, maybeUpdateDuration] = measureSlowPhase(
      maybeSlowUpdate,
      () => update(previousModel, message),
    )
    const nextModel = prepareModel(messageUpdate.model)

    reportSlowPhase<SlowUpdateContext<Model, Message>>(
      maybeSlowUpdate,
      maybeUpdateDuration,
      (durationMs, thresholdMs) => ({
        _tag: 'Update',
        previousModel,
        nextModel,
        message,
        durationMs,
        thresholdMs,
      }),
    )

    if (previousModel !== nextModel) {
      liveModel = nextModel
      onModelChanged(nextModel, message)
    }

    runCommands(messageUpdate.commands, Option.some(message))
    recordMessage(
      message,
      previousModel,
      nextModel,
      messageUpdate.commands ?? [],
    )
  }

  return { readModel: () => liveModel, processMessage, runCommands }
}
