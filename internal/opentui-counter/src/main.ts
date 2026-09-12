import { Effect, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import type * as Update from 'foldkit/update'

// MODEL

export const Model = Schema.Struct({
  count: Schema.Number,
  timer: Schema.Literals(['Running', 'Stopped']),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedIncrement: {},
  PressedDecrement: {},
  PressedDelayedIncrement: {},
  PressedToggleTimer: {},
  CompletedWaitBeforeIncrement: {},
  Ticked: {},
})
export type Message = typeof Message.Type

// COMMAND

const WaitBeforeIncrement = Command.define('WaitBeforeIncrement', {
  messages: [Message.CompletedWaitBeforeIncrement],
  execute: Effect.sleep('1 second').pipe(
    Effect.as(Message.CompletedWaitBeforeIncrement()),
  ),
})

// INIT

export const init = (): Update.Return<Model, Message> => ({
  model: { count: 0, timer: 'Stopped' },
})

// UPDATE

const increment = (model: Model) => ({
  model: evo(model, { count: count => count + 1 }),
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedIncrement: () => increment(model),
    PressedDecrement: () => ({
      model: evo(model, { count: count => count - 1 }),
    }),
    PressedDelayedIncrement: () => ({
      model,
      commands: [WaitBeforeIncrement()],
    }),
    PressedToggleTimer: () => ({
      model: evo(model, {
        timer: timer => (timer === 'Running' ? 'Stopped' : 'Running'),
      }),
    }),
    CompletedWaitBeforeIncrement: () => increment(model),
    Ticked: () => increment(model),
  })

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  timer: entry(
    { timer: Model.fields.timer },
    {
      modelToDependencies: model => ({ timer: model.timer }),
      dependenciesToStream: ({ timer }) =>
        timer === 'Running'
          ? Stream.tick('1 second').pipe(Stream.map(() => Message.Ticked()))
          : Stream.empty,
    },
  ),
}))

// VIEW

export const view = (model: Model): string =>
  `Count: ${model.count}\nTimer: ${model.timer}\n\nUp / Down: change count\na: increment after 1 second\nSpace: toggle timer\nq / Ctrl+C: quit`
