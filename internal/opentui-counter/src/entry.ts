import { Effect } from 'effect'
import * as Runtime from 'foldkit/experimental/runtime'

import { createCliRenderer } from '@opentui/core'

import { makeHost } from './host.js'
import { init, subscriptions, update } from './main.js'

await Effect.runPromise(
  Runtime.run({
    init,
    update,
    subscriptions,
    host: makeHost(
      Effect.promise(() => createCliRenderer({ exitOnCtrlC: false })),
    ),
  }),
)
