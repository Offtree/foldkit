import { expect, test } from 'bun:test'
import { Deferred, Effect, Fiber } from 'effect'
import * as Runtime from 'foldkit/experimental/runtime'

import { InputRenderable, type Renderable } from '@opentui/core'
import {
  type TestRendererSetup,
  createTestRenderer,
} from '@opentui/core/testing'

import { makeListHost } from '../example/host.js'
import { init, update } from '../example/main.js'

const descendants = (parent: Renderable): Array<Renderable> =>
  parent.getChildren().flatMap(child => [child, ...descendants(child)])

const waitForFrame = (
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

test('editable list routes typing through update, reorders, adds, removes and quits with scoped cleanup', async () => {
  const ready = Deferred.makeUnsafe<TestRendererSetup>()
  let initialKeyListeners = 0
  const fiber = Effect.runFork(
    Runtime.run({
      init,
      update,
      host: makeListHost(
        Effect.promise(async () => {
          const setup = await createTestRenderer({
            width: 90,
            height: 24,
            useThread: false,
            exitOnCtrlC: false,
          })
          initialKeyListeners =
            setup.renderer.keyInput.listenerCount('keypress')
          Deferred.doneUnsafe(ready, Effect.succeed(setup))
          return setup.renderer
        }),
      ),
    }),
  )
  try {
    const setup = await Effect.runPromise(
      Deferred.await(ready).pipe(Effect.timeout('3 seconds')),
    )
    await waitForFrame(setup, 'First')
    setup.mockInput.pressKey('x')
    await waitForFrame(setup, 'Firstx')
    setup.mockInput.pressKey('r', { ctrl: true })
    const frame = await waitForFrame(
      setup,
      frame =>
        frame.includes('Second') &&
        frame.includes('Firstx') &&
        frame.indexOf('Second') < frame.indexOf('Firstx'),
    )
    expect(frame.indexOf('Second')).toBeLessThan(frame.indexOf('Firstx'))
    setup.mockInput.pressKey('y')
    await waitForFrame(setup, 'Firstxy')
    setup.mockInput.pressKey('n', { ctrl: true })
    await waitForFrame(setup, 'Item 3')
    setup.mockInput.pressKey('z')
    await waitForFrame(setup, 'z')
    setup.mockInput.pressKey('d', { ctrl: true })
    expect(
      await waitForFrame(setup, frame => !frame.includes('Item 3')),
    ).not.toContain('Item 3')
    setup.mockInput.pressKey('c', { ctrl: true })
    await Effect.runPromise(Fiber.join(fiber).pipe(Effect.timeout('3 seconds')))
    expect(setup.renderer.isDestroyed).toBe(true)
    expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(
      initialKeyListeners,
    )
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})

test('rejected edits are restored from the unchanged Model', async () => {
  const ready = Deferred.makeUnsafe<TestRendererSetup>()
  const fiber = Effect.runFork(
    Runtime.run({
      init,
      update: model => ({ model }),
      host: makeListHost(
        Effect.promise(async () => {
          const setup = await createTestRenderer({
            width: 90,
            height: 24,
            useThread: false,
            exitOnCtrlC: false,
          })
          Deferred.doneUnsafe(ready, Effect.succeed(setup))
          return setup.renderer
        }),
      ),
    }),
  )
  try {
    const setup = await Effect.runPromise(
      Deferred.await(ready).pipe(Effect.timeout('3 seconds')),
    )
    await waitForFrame(setup, 'First')
    setup.mockInput.pressKey('x')
    await waitForFrame(setup, frame => !frame.includes('Firstx'))
    const input = descendants(setup.renderer.root).find(
      child => child instanceof InputRenderable && child.focused,
    )
    if (!(input instanceof InputRenderable)) {
      throw new Error('Missing focused input')
    }
    expect(input.value).toBe('First')
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})

test('mouse selection updates the Model before selection-based shortcuts run', async () => {
  const ready = Deferred.makeUnsafe<TestRendererSetup>()
  const fiber = Effect.runFork(
    Runtime.run({
      init,
      update,
      host: makeListHost(
        Effect.promise(async () => {
          const setup = await createTestRenderer({
            width: 90,
            height: 24,
            useThread: false,
            exitOnCtrlC: false,
          })
          Deferred.doneUnsafe(ready, Effect.succeed(setup))
          return setup.renderer
        }),
      ),
    }),
  )
  try {
    const setup = await Effect.runPromise(
      Deferred.await(ready).pipe(Effect.timeout('3 seconds')),
    )
    await waitForFrame(setup, 'Second')
    const input = descendants(setup.renderer.root).find(
      child => child instanceof InputRenderable && child.value === 'Second',
    )
    if (!(input instanceof InputRenderable)) {
      throw new Error('Missing second input')
    }
    await setup.mockMouse.click(input.x, input.y)
    setup.mockInput.pressKey('d', { ctrl: true })
    const frame = await waitForFrame(
      setup,
      frame => !frame.includes('Item 1') || !frame.includes('Item 2'),
    )
    expect(frame).toContain('Item 1')
    expect(frame).not.toContain('Item 2')
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})
