// @vitest-environment node
import {
  Array,
  Cause,
  Effect,
  Exit,
  Fiber,
  Function,
  Option,
  Schema,
  type Scope,
  Stream,
} from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as Command from '../../command/index.js'
import * as ManagedResource from '../../managedResource/index.js'
import { defineMessageUnion } from '../../message/index.js'
import { evo } from '../../struct/index.js'
import * as Subscription from '../../subscription/subscription.js'
import type * as Update from '../../update/index.js'
import { type Config, type Controls, type Host, run } from './runtime.js'

const Model = Schema.Struct({
  count: Schema.Number,
  mode: Schema.Literals(['Running', 'Stopped']),
})
type Model = typeof Model.Type
const Message = defineMessageUnion({
  PressedIncrement: {},
  CompletedIncrement: {},
  StartedTimer: {},
  StoppedTimer: {},
  Ticked: {},
  AcquiredHandle: {},
  ReleasedHandle: {},
  FailedHandle: {},
  ThrewInUpdate: {},
})
type Message = typeof Message.Type

const Increment = Command.define('Increment', {
  messages: [Message.CompletedIncrement],
  execute: Effect.succeed(Message.CompletedIncrement()),
})

const init = (): Update.Return<Model, Message> => ({
  model: { count: 0, mode: 'Stopped' },
})
const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedIncrement: () => ({
      model: evo(model, { count: count => count + 1 }),
      commands: [Increment()],
    }),
    CompletedIncrement: () => ({
      model: evo(model, { count: count => count + 1 }),
    }),
    StartedTimer: () => ({ model: evo(model, { mode: () => 'Running' }) }),
    StoppedTimer: () => ({ model: evo(model, { mode: () => 'Stopped' }) }),
    Ticked: () => ({ model: evo(model, { count: count => count + 1 }) }),
    AcquiredHandle: () => ({ model }),
    ReleasedHandle: () => ({ model }),
    FailedHandle: () => ({ model }),
    ThrewInUpdate: () => {
      throw new Error('update failed')
    },
  })

const makeHarness = () => {
  const commits: Array<Model> = []
  const processed: Array<Message> = []
  const lifecycle: Array<string> = []
  let maybeControls = Option.none<Controls<Message>>()
  let maybeScheduledCommit = Option.none<() => void>()

  const host = (
    controls: Controls<Message>,
  ): Effect.Effect<Host<Model>, never, Scope.Scope> =>
    Effect.acquireRelease(
      Effect.sync(() => {
        maybeControls = Option.some(controls)
        lifecycle.push('acquired')
        return {
          commit: (model: Model) => {
            commits.push(model)
          },
          scheduleCommit: (commit: () => void) => {
            maybeScheduledCommit = Option.some(commit)
            return () => {
              maybeScheduledCommit = Option.none()
              lifecycle.push('cancelled')
            }
          },
        }
      }),
      () =>
        Effect.sync(() => {
          lifecycle.push('released')
          controls.dispatch(Message.PressedIncrement())
        }),
    )

  return {
    commits,
    processed,
    lifecycle,
    host,
    controls: () => Option.getOrThrow(maybeControls),
    commit: () => {
      const commit = Option.getOrThrow(maybeScheduledCommit)
      maybeScheduledCommit = Option.none()
      commit()
    },
    update: (model: Model, message: Message) => {
      processed.push(message)
      return update(model, message)
    },
  }
}

const running: Array<Fiber.Fiber<void>> = []
const start = (config: Config<Model, Message>) => {
  const fiber = Effect.runFork(run(config))
  running.push(fiber)
  return fiber
}

afterEach(async () => {
  await Effect.runPromise(
    Effect.forEach(running, Fiber.interrupt, { discard: true }),
  )
  running.splice(0)
  vi.restoreAllMocks()
})

describe('non-browser host runtime', () => {
  it('coalesces requested commits of unchanged Models and ignores requests during acquisition and after stop', async () => {
    const harness = makeHarness()
    const fiber = start({
      init,
      update: harness.update,
      host: controls => {
        controls.requestCommit()
        return harness.host(controls)
      },
    })
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().dispatch(Message.AcquiredHandle())
    harness.controls().requestCommit()
    harness.controls().requestCommit()
    harness.commit()
    expect(harness.commits).toHaveLength(2)
    expect(Array.last(harness.commits).pipe(Option.getOrThrow)).toBe(
      Array.head(harness.commits).pipe(Option.getOrThrow),
    )
    expect(() => harness.commit()).toThrow()
    harness.controls().requestCommit()
    harness.controls().stop()
    await Effect.runPromise(Fiber.join(fiber))
    harness.controls().requestCommit()
    expect(() => harness.commit()).toThrow()
    expect(harness.lifecycle).toEqual(['acquired', 'cancelled', 'released'])
  })

  it('fails the runtime when scheduling an explicit commit throws', async () => {
    const harness = makeHarness()
    const fiber = start({
      init,
      update,
      host: controls =>
        harness.host(controls).pipe(
          Effect.map(host => ({
            ...host,
            scheduleCommit: () => {
              throw new Error('scheduler failed')
            },
          })),
        ),
    })
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().requestCommit()
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(harness.lifecycle).toEqual(['acquired', 'released'])
  })

  it('orders boot events and Command results, batches commits, and drops teardown dispatches', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const harness = makeHarness()
    const fiber = start({
      init,
      update: harness.update,
      host: controls => {
        controls.dispatch(Message.PressedIncrement())
        return harness.host(controls)
      },
    })

    await vi.waitFor(() =>
      expect(harness.processed.map(message => message._tag)).toEqual([
        'PressedIncrement',
        'CompletedIncrement',
      ]),
    )
    expect(harness.commits).toEqual([{ count: 0, mode: 'Stopped' }])
    harness.controls().dispatch(Message.PressedIncrement())
    expect(Array.last(harness.processed).pipe(Option.getOrThrow)._tag).toBe(
      'PressedIncrement',
    )
    harness.commit()
    expect(Array.last(harness.commits).pipe(Option.getOrThrow).count).toBe(3)

    await vi.waitFor(() => expect(harness.processed).toHaveLength(4))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(harness.lifecycle).toEqual(['acquired', 'cancelled', 'released'])
    harness.controls().dispatch(Message.PressedIncrement())
    expect(harness.processed).toHaveLength(4)
  })

  it('restarts a Model-gated Subscription and releases it on stop and disposal', async () => {
    const harness = makeHarness()
    const lifecycle: Array<string> = []
    const subscriptions = Subscription.make<Model, Message>()(entry => ({
      timer: entry(
        { mode: Model.fields.mode },
        {
          modelToDependencies: model => ({ mode: model.mode }),
          dependenciesToStream: ({ mode }) =>
            mode === 'Stopped'
              ? Stream.empty
              : Stream.scoped(
                  Stream.fromEffect(
                    Effect.acquireRelease(
                      Effect.sync(() => {
                        lifecycle.push('started')
                        return Message.Ticked()
                      }),
                      () =>
                        Effect.sync(() => {
                          lifecycle.push('stopped')
                        }),
                    ),
                  ).pipe(Stream.concat(Stream.never)),
                ),
        },
      ),
    }))
    const fiber = start({
      init,
      update: harness.update,
      host: harness.host,
      subscriptions,
    })
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().dispatch(Message.StartedTimer())
    await vi.waitFor(() =>
      expect(harness.processed.some(message => message._tag === 'Ticked')).toBe(
        true,
      ),
    )
    harness.controls().dispatch(Message.StoppedTimer())
    await vi.waitFor(() => expect(lifecycle).toEqual(['started', 'stopped']))
    harness.controls().dispatch(Message.StartedTimer())
    await vi.waitFor(() =>
      expect(lifecycle).toEqual(['started', 'stopped', 'started']),
    )
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(lifecycle).toEqual(['started', 'stopped', 'started', 'stopped'])
  })

  it('interrupts an in-flight Command and runs its finalizer on host stop', async () => {
    const harness = makeHarness()
    const lifecycle: Array<string> = []
    const Wait = Command.define('Wait', {
      messages: [Message.CompletedIncrement],
      execute: Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              lifecycle.push('started')
            }),
            () =>
              Effect.sync(() => {
                lifecycle.push('released')
              }),
          )
          yield* Effect.never
          return Message.CompletedIncrement()
        }),
      ),
    })
    const fiber = start({
      init: () => ({ model: init().model, commands: [Wait()] }),
      update: harness.update,
      host: harness.host,
    })
    await vi.waitFor(() => expect(lifecycle).toEqual(['started']))
    harness.controls().stop()
    await Effect.runPromise(Fiber.join(fiber))
    expect(lifecycle).toEqual(['started', 'released'])
    expect(harness.processed).toEqual([])
    expect(harness.lifecycle).toEqual(['acquired', 'released'])
  })

  it('fails and releases the host when the initial commit throws', async () => {
    const harness = makeHarness()
    const exit = await Effect.runPromiseExit(
      run({
        init,
        update: harness.update,
        host: controls =>
          harness.host(controls).pipe(
            Effect.map(host => ({
              ...host,
              commit: () => {
                throw new Error('commit failed')
              },
            })),
          ),
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain('commit failed')
    }
    expect(harness.lifecycle).toEqual(['acquired', 'released'])
    expect(harness.processed).toEqual([])
  })

  it('stops after an update defect before a queued Command starts', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const harness = makeHarness()
    const fiber = start({ init, update: harness.update, host: harness.host })
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().dispatch(Message.PressedIncrement())
    harness.controls().dispatch(Message.ThrewInUpdate())
    harness.controls().dispatch(Message.PressedIncrement())
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(harness.processed.map(message => message._tag)).toEqual([
      'PressedIncrement',
      'ThrewInUpdate',
    ])
    expect(harness.lifecycle).toEqual(['acquired', 'cancelled', 'released'])
  })

  it('releases partially acquired host resources when startup fails', async () => {
    const harness = makeHarness()
    const exit = await Effect.runPromiseExit(
      run({
        init,
        update: harness.update,
        host: controls =>
          harness
            .host(controls)
            .pipe(Effect.andThen(Effect.die(new Error('host setup failed')))),
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(harness.lifecycle).toEqual(['acquired', 'released'])
    expect(harness.processed).toEqual([])
    expect(harness.commits).toEqual([])
  })

  it('fails the runtime when a scheduled commit throws', async () => {
    const harness = makeHarness()
    const fiber = start({
      init,
      update: harness.update,
      host: controls =>
        harness.host(controls).pipe(
          Effect.map(host => ({
            ...host,
            commit: model => {
              if (model.count > 0) {
                throw new Error('scheduled commit failed')
              }
              host.commit(model)
            },
          })),
        ),
    })
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().dispatch(Message.Ticked())
    harness.commit()
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain('scheduled commit failed')
    }
    expect(harness.lifecycle).toEqual(['acquired', 'released'])
  })

  it('propagates a Command defect and releases the host', async () => {
    const harness = makeHarness()
    const Fail = Command.define('Fail', {
      messages: [Message.CompletedIncrement],
      execute: Effect.die(new Error('command failed')).pipe(
        Effect.as(Message.CompletedIncrement()),
      ),
    })
    const exit = await Effect.runPromiseExit(
      run({
        init: () => ({ model: init().model, commands: [Fail()] }),
        update: harness.update,
        host: harness.host,
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain('command failed')
    }
    expect(harness.lifecycle).toEqual(['acquired', 'released'])
    expect(harness.processed).toEqual([])
  })

  it('buffers commit-time Messages until the commit finishes', async () => {
    const harness = makeHarness()
    const observations: Array<number> = []
    const fiber = start({
      init,
      update: harness.update,
      host: controls =>
        harness.host(controls).pipe(
          Effect.map(host => ({
            ...host,
            commit: model => {
              host.commit(model)
              if (model.count === 2) {
                controls.dispatch(Message.Ticked())
                observations.push(harness.processed.length)
              }
            },
          })),
        ),
    })
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().dispatch(Message.PressedIncrement())
    await vi.waitFor(() => expect(harness.processed).toHaveLength(2))
    harness.commit()
    expect(observations).toEqual([2])
    expect(harness.processed).toHaveLength(3)
    harness.commit()
    expect(Array.last(harness.commits).pipe(Option.getOrThrow).count).toBe(3)
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it('acquires and releases ManagedResources as Model requirements change', async () => {
    const harness = makeHarness()
    const lifecycle: Array<string> = []
    const Handle =
      ManagedResource.tag<typeof Schema.String.Type>()('TerminalTestHandle')
    const managedResources = ManagedResource.make<Model, Message>()(entry => ({
      handle: entry(Schema.Option(Schema.String), {
        resource: Handle,
        modelToMaybeRequirements: model =>
          model.mode === 'Running' ? Option.some('handle') : Option.none(),
        acquire: value =>
          Effect.sync(() => {
            lifecycle.push('acquired')
            return value
          }),
        release: () =>
          Effect.sync(() => {
            lifecycle.push('released')
          }),
        onAcquired: () => Message.AcquiredHandle(),
        onReleased: () => Message.ReleasedHandle(),
        onAcquireError: Function.constant(Message.FailedHandle()),
      }),
    }))
    const fiber = Effect.runFork(
      run({
        init,
        update: harness.update,
        host: harness.host,
        managedResources,
      }),
    )
    running.push(fiber)
    await vi.waitFor(() => expect(harness.commits).toHaveLength(1))
    harness.controls().dispatch(Message.StartedTimer())
    await vi.waitFor(() =>
      expect(
        harness.processed.some(message => message._tag === 'AcquiredHandle'),
      ).toBe(true),
    )
    harness.controls().dispatch(Message.StoppedTimer())
    await vi.waitFor(() => expect(lifecycle).toEqual(['acquired', 'released']))
    harness.controls().dispatch(Message.StartedTimer())
    await vi.waitFor(() =>
      expect(lifecycle).toEqual(['acquired', 'released', 'acquired']),
    )
    const processedBeforeDisposal = harness.processed.length
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(lifecycle).toEqual(['acquired', 'released', 'acquired', 'released'])
    expect(harness.processed).toHaveLength(processedBeforeDisposal)
  })
})
