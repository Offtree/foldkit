import { Effect, type Scope } from 'effect'
import type { Controls, Host } from 'foldkit/experimental/runtime'

import { TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core'

import { Message, type Model, view } from './main.js'

export const makeHost =
  (acquireRenderer: Effect.Effect<CliRenderer>) =>
  (
    controls: Controls<Message>,
  ): Effect.Effect<Host<Model>, never, Scope.Scope> =>
    Effect.gen(function* () {
      const renderer = yield* Effect.acquireRelease(acquireRenderer, renderer =>
        Effect.sync(() => renderer.destroy()),
      )
      const text = new TextRenderable(renderer, {
        id: 'counter',
        content: '',
        padding: 1,
      })
      renderer.root.add(text)

      const onKey = (key: KeyEvent): void => {
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
          controls.stop()
          return
        }
        if (key.name === 'up') {
          controls.dispatch(Message.PressedIncrement())
        }
        if (key.name === 'down') {
          controls.dispatch(Message.PressedDecrement())
        }
        if (key.name === 'a') {
          controls.dispatch(Message.PressedDelayedIncrement())
        }
        if (key.name === 'space') {
          controls.dispatch(Message.PressedToggleTimer())
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          renderer.keyInput.on('keypress', onKey)
          renderer.on('destroy', controls.stop)
        }),
        () =>
          Effect.sync(() => {
            renderer.keyInput.off('keypress', onKey)
            renderer.off('destroy', controls.stop)
          }),
      )

      return {
        commit: model => {
          text.content = view(model)
        },
        scheduleCommit: commit => {
          const task = setImmediate(commit)
          return () => clearImmediate(task)
        },
      }
    })
