import { Effect, Match } from 'effect'

import type { CliRenderer } from '@opentui/core'

import { makeHost } from '../src/index.js'
import { Message, view } from './main.js'

export const makeFormHost = (acquireRenderer: Effect.Effect<CliRenderer>) =>
  makeHost({
    acquireRenderer,
    view,
    onKey: (key, controls) => {
      if (key.ctrl && key.name === 'c') {
        key.preventDefault()
        controls.stop()
        return
      }
      const message = Match.value(key).pipe(
        Match.when({ ctrl: true, name: 'n' }, () => Message.PressedNextField()),
        Match.orElse(() => undefined),
      )
      if (message) {
        key.preventDefault()
        controls.dispatch(message)
      }
    },
  })
