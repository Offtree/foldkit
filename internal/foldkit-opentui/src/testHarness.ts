import { Deferred, Effect } from 'effect'

import type { CliRenderer } from '@opentui/core'
import {
  type TestRendererSetup,
  createTestRenderer,
} from '@opentui/core/testing'

export type TestRendererHost = Readonly<{
  acquireRenderer: Effect.Effect<CliRenderer>
  awaitSetup: () => Promise<TestRendererSetup>
}>

export const makeTestRendererHost = (
  options: Readonly<{
    width: number
    height: number
    onCreate?: (setup: TestRendererSetup) => void
  }>,
): TestRendererHost => {
  const ready = Deferred.makeUnsafe<TestRendererSetup>()
  const acquireRenderer = Effect.promise(async () => {
    const setup = await createTestRenderer({
      width: options.width,
      height: options.height,
      useThread: false,
      exitOnCtrlC: false,
    })
    options.onCreate?.(setup)
    Deferred.doneUnsafe(ready, Effect.succeed(setup))
    return setup.renderer
  })
  return {
    acquireRenderer,
    awaitSetup: () =>
      Effect.runPromise(
        Deferred.await(ready).pipe(Effect.timeout('3 seconds')),
      ),
  }
}

export const waitForFrame = (
  setup: TestRendererSetup,
  matches: string | ((frame: string) => boolean),
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.promise(() => setup.renderOnce())
        const frame = setup.captureCharFrame()
        if (
          typeof matches === 'string' ? frame.includes(matches) : matches(frame)
        ) {
          return frame
        }
        yield* Effect.sleep('10 millis')
      }
    }).pipe(Effect.timeout('3 seconds')),
  )
