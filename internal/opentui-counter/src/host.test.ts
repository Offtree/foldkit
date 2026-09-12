import { expect, test } from 'bun:test'
import { Deferred, Effect, Fiber } from 'effect'
import * as Runtime from 'foldkit/experimental/runtime'

import {
  createTestRenderer,
  type TestRendererSetup,
} from '@opentui/core/testing'

import { makeHost } from './host.js'
import { init, subscriptions, update } from './main.js'

const waitForFrame = (setup: TestRendererSetup, text: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.promise(() => setup.renderOnce())
        const frame = setup.captureCharFrame()
        if (frame.includes(text)) {
          return frame
        }
        yield* Effect.sleep('10 millis')
      }
    }).pipe(Effect.timeout('3 seconds')),
  )

test('renders keyboard updates, delayed Commands and a gated timer, then destroys the renderer on quit', async () => {
  const ready = Deferred.makeUnsafe<TestRendererSetup>()
  const acquireRenderer = Effect.promise(async () => {
    const setup = await createTestRenderer({
      width: 60,
      height: 12,
      useThread: false,
      exitOnCtrlC: false,
    })
    Deferred.doneUnsafe(ready, Effect.succeed(setup))
    return setup.renderer
  })
  const fiber = Effect.runFork(
    Runtime.run({
      init,
      update,
      subscriptions,
      host: makeHost(acquireRenderer),
    }),
  )

  try {
    const setup = await Effect.runPromise(
      Deferred.await(ready).pipe(Effect.timeout('3 seconds')),
    )
    expect(await waitForFrame(setup, 'Count: 0')).toContain('Timer: Stopped')

    setup.mockInput.pressArrow('up')
    await waitForFrame(setup, 'Count: 1')
    setup.mockInput.pressArrow('down')
    await waitForFrame(setup, 'Count: 0')

    setup.mockInput.pressKey('a')
    await waitForFrame(setup, 'Count: 1')
    setup.mockInput.pressKey(' ')
    expect(await waitForFrame(setup, 'Count: 2')).toContain('Timer: Running')
    setup.mockInput.pressKey(' ')
    await waitForFrame(setup, 'Timer: Stopped')
    await Effect.runPromise(Effect.sleep('1100 millis'))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('Count: 2')

    setup.mockInput.pressKey('q')
    await Effect.runPromise(Fiber.join(fiber).pipe(Effect.timeout('3 seconds')))
    expect(setup.renderer.isDestroyed).toBe(true)
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
}, 10000)
