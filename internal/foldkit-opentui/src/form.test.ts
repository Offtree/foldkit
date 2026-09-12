import { expect, test } from 'bun:test'
import { Effect, Fiber } from 'effect'
import * as Runtime from 'foldkit/experimental/runtime'

import {
  BoxRenderable,
  InputRenderable,
  MouseButton,
  type Renderable,
  TextRenderable,
} from '@opentui/core'
import type { TestRendererSetup } from '@opentui/core/testing'

import { makeFormHost } from '../form/host.js'
import { init, update } from '../form/main.js'
import { makeTestRendererHost, waitForFrame } from './testHarness.js'

const descendants = (parent: Renderable): Array<Renderable> =>
  parent.getChildren().flatMap(child => [child, ...descendants(child)])

const textContentOf = (renderable: Renderable): string | undefined => {
  if (!(renderable instanceof TextRenderable)) {
    return undefined
  }
  return renderable.content.chunks.map(chunk => chunk.text).join('')
}

const findButton = (parent: Renderable, label: string): BoxRenderable => {
  const text = descendants(parent).find(child => textContentOf(child) === label)
  if (!(text?.parent instanceof BoxRenderable)) {
    throw new Error(`Missing button: ${label}`)
  }
  return text.parent
}

const waitForFocusedInput = (setup: TestRendererSetup, value: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      while (true) {
        const input = descendants(setup.renderer.root).find(
          child => child instanceof InputRenderable && child.focused,
        )
        if (input instanceof InputRenderable && input.value === value) {
          return
        }
        yield* Effect.sleep('10 millis')
      }
    }).pipe(Effect.timeout('3 seconds')),
  )

test('Enter submits, rejections render, edits resume, and a valid submit completes', async () => {
  const host = makeTestRendererHost({ width: 60, height: 16 })
  const fiber = Effect.runFork(
    Runtime.run({
      init,
      update,
      host: makeFormHost(host.acquireRenderer),
    }),
  )
  try {
    const setup = await host.awaitSetup()
    await waitForFrame(setup, 'Sign-up form')
    setup.mockInput.pressKey('A')
    setup.mockInput.pressKey('d')
    setup.mockInput.pressKey('a')
    await waitForFrame(
      setup,
      frame => frame.includes('Ada') && !frame.includes('Ada Lovelace'),
    )
    setup.mockInput.pressEnter()
    await waitForFrame(setup, 'Enter a valid email address.')
    setup.mockInput.pressKey('b')
    await waitForFrame(setup, 'Fill the fields, then submit.')
    setup.mockInput.pressKey('n', { ctrl: true })
    await waitForFocusedInput(setup, '')
    for (const character of 'ada@x') {
      setup.mockInput.pressKey(character)
    }
    await waitForFrame(setup, 'ada@x')
    setup.mockInput.pressEnter()
    await waitForFrame(setup, 'Submitted. Ctrl+C quits.')
    setup.mockInput.pressKey('z')
    await waitForFrame(setup, 'Fill the fields, then submit.')
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})

test('clicking the button submits and quit releases the renderer', async () => {
  const host = makeTestRendererHost({ width: 60, height: 16 })
  const fiber = Effect.runFork(
    Runtime.run({
      init,
      update,
      host: makeFormHost(host.acquireRenderer),
    }),
  )
  try {
    const setup = await host.awaitSetup()
    await waitForFrame(setup, 'Submit')
    const button = findButton(setup.renderer.root, 'Submit')
    await setup.mockMouse.click(button.x + 1, button.y + 1, MouseButton.RIGHT)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain('Name is required.')
    await setup.mockMouse.click(button.x + 1, button.y + 1)
    await waitForFrame(setup, 'Name is required.')
    expect(setup.renderer.hasSelection).toBe(false)
    setup.mockInput.pressKey('c', { ctrl: true })
    await Effect.runPromise(Fiber.join(fiber).pipe(Effect.timeout('3 seconds')))
    expect(setup.renderer.isDestroyed).toBe(true)
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})
