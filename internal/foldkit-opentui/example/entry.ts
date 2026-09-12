import { Effect } from 'effect'
import * as Runtime from 'foldkit/experimental/runtime'

import { createCliRenderer } from '@opentui/core'

import { makeListHost } from './host.js'
import { init, update } from './main.js'

await Effect.runPromise(
  Runtime.run({
    init,
    update,
    host: makeListHost(
      Effect.promise(() => createCliRenderer({ exitOnCtrlC: false })),
    ),
  }),
)
