import { Effect } from 'effect'
import type { Controls } from 'foldkit/experimental/runtime'

import type { CliRenderer, KeyEvent } from '@opentui/core'

import { createReconciler } from './reconciler.js'
import type { View } from './view.js'

export const makeHost =
  <Model, Message>(
    options: Readonly<{
      acquireRenderer: Effect.Effect<CliRenderer>
      view: (model: Model) => View<Message>
      onKey?: (key: KeyEvent, controls: Controls<Message>) => void
    }>,
  ) =>
  (controls: Controls<Message>) =>
    Effect.gen(function* () {
      const renderer = yield* Effect.acquireRelease(
        options.acquireRenderer,
        renderer => Effect.sync(() => renderer.destroy()),
      )
      const tree = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createReconciler<Message>(renderer, message => {
            controls.dispatch(message)
            controls.requestCommit()
          }),
        ),
        tree => Effect.sync(tree.dispose),
      )
      const onKey = (key: KeyEvent) => options.onKey?.(key, controls)
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
        commit: (model: Model) => tree.commit(options.view(model)),
        scheduleCommit: (commit: () => void) => {
          const handle = setImmediate(commit)
          return () => clearImmediate(handle)
        },
      }
    })
