import { expect, test } from 'bun:test'
import { Array, Option, Schema } from 'effect'

import { InputRenderable, type Renderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'

import { createReconciler } from './reconciler.js'
import { createView } from './view.js'

const Message = Schema.Struct({ id: Schema.String, value: Schema.String })
type Message = typeof Message.Type
const h = createView<Message>()
const descendants = (parent: Renderable): globalThis.Array<Renderable> =>
  parent.getChildren().flatMap(child => [child, ...descendants(child)])
const findInput = (parent: Renderable, value: string): InputRenderable => {
  const input = descendants(parent).find(
    child => child instanceof InputRenderable && child.value === value,
  )
  if (!(input instanceof InputRenderable)) {
    throw new Error(`Input missing: ${value}`)
  }
  return input
}
const row = (id: string, value: string, isFocused = false) =>
  h.box({ key: id }, [
    h.text(id),
    h.input({
      value,
      isFocused,
      onInput: value => Message.make({ id, value }),
    }),
  ])

test('keyed moves preserve native input identity, cursor, focus and the latest Message mapping', async () => {
  const setup = await createTestRenderer({
    width: 40,
    height: 12,
    useThread: false,
  })
  const messages: globalThis.Array<Message> = []
  const tree = createReconciler<Message>(setup.renderer, message =>
    messages.push(message),
  )
  try {
    tree.commit(h.box({}, [row('a', 'Alpha', true), row('b', 'Beta')]))
    const alpha = findInput(setup.renderer.root, 'Alpha')
    alpha.cursorOffset = 2
    tree.commit(h.box({}, [row('b', 'Beta'), row('a', 'Alpha', true)]))
    expect(findInput(setup.renderer.root, 'Alpha')).toBe(alpha)
    expect(alpha.cursorOffset).toBe(2)
    expect(alpha.focused).toBe(true)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame.indexOf('Beta')).toBeLessThan(frame.indexOf('Alpha'))
    setup.mockInput.pressKey('x')
    expect(messages).toEqual([{ id: 'a', value: 'Alxpha' }])

    tree.commit(
      h.box({}, [
        h.box({ key: 'a' }, [
          h.text('a'),
          h.input({
            value: 'Alxpha',
            isFocused: true,
            onInput: value => Message.make({ id: 'latest', value }),
          }),
        ]),
      ]),
    )
    setup.mockInput.pressKey('y')
    expect(messages).toContainEqual({ id: 'latest', value: 'Alxypha' })
  } finally {
    tree.dispose()
    setup.renderer.destroy()
  }
})

test('Model writes do not echo Messages; removal releases listeners and native handles', async () => {
  const setup = await createTestRenderer({
    width: 40,
    height: 12,
    useThread: false,
  })
  const messages: globalThis.Array<Message> = []
  const tree = createReconciler<Message>(setup.renderer, message =>
    messages.push(message),
  )
  try {
    tree.commit(h.box({}, [row('a', 'Alpha', true)]))
    const input = findInput(setup.renderer.root, 'Alpha')
    tree.commit(h.box({}, [row('a', 'Replacement', true)]))
    expect(input.value).toBe('Replacement')
    expect(messages).toEqual([])
    tree.commit(h.box({}))
    expect(input.isDestroyed).toBe(true)
    expect(input.listenerCount('input')).toBe(0)
    input.emit('input', 'late')
    expect(messages).toEqual([])
    tree.dispose()
    tree.dispose()
    expect(setup.renderer.root.getChildren()).toEqual([])
  } finally {
    tree.dispose()
    setup.renderer.destroy()
  }
})

test('duplicate sibling keys and ambiguous focus are rejected before changing the tree', async () => {
  const setup = await createTestRenderer({
    width: 40,
    height: 12,
    useThread: false,
  })
  const tree = createReconciler<Message>(setup.renderer, () => {})
  try {
    tree.commit(row('a', 'Alpha', true))
    const input = findInput(setup.renderer.root, 'Alpha')
    expect(() =>
      tree.commit(h.box({}, [row('a', 'Other'), row('a', 'Duplicate')])),
    ).toThrow('Duplicate sibling key')
    expect(() =>
      tree.commit(
        h.box({}, [row('a', 'Other', true), row('b', 'Second', true)]),
      ),
    ).toThrow('Only one input')
    expect(input.isDestroyed).toBe(false)
    expect(input.value).toBe('Alpha')
  } finally {
    tree.dispose()
    setup.renderer.destroy()
  }
})

test('same key with a new kind replaces the native node; omitted props reset to defaults', async () => {
  const setup = await createTestRenderer({
    width: 40,
    height: 12,
    useThread: false,
  })
  const tree = createReconciler<Message>(setup.renderer, () => {})
  try {
    tree.commit(
      h.box({ padding: 2 }, [
        h.input({
          key: 'entity',
          value: 'Alpha',
          isFocused: true,
          placeholder: 'Hint',
          onInput: value => Message.make({ id: 'a', value }),
        }),
      ]),
    )
    const input = findInput(setup.renderer.root, 'Alpha')
    tree.commit(
      h.box({}, [
        h.input({
          key: 'entity',
          value: 'Alpha',
          onInput: value => Message.make({ id: 'a', value }),
        }),
      ]),
    )
    expect(input.focused).toBe(false)
    tree.commit(h.box({}, [h.text('Replaced', { key: 'entity' })]))
    expect(input.isDestroyed).toBe(true)
    expect(input.listenerCount('input')).toBe(0)
    await setup.renderOnce()
    expect(setup.captureCharFrame().startsWith('Replaced')).toBe(true)
  } finally {
    tree.dispose()
    setup.renderer.destroy()
  }
})

test('partial commit failure releases newly mounted nodes and closes the tree', async () => {
  const setup = await createTestRenderer({
    width: 40,
    height: 12,
    useThread: false,
  })
  const tree = createReconciler<Message>(setup.renderer, () => {})
  try {
    const view = h.box({}, [row('a', 'Alpha'), h.text('broken')])
    if (view._tag !== 'Box') {
      throw new Error('Expected a box')
    }
    const broken = Option.getOrThrow(Array.last(view.children))
    Object.defineProperty(broken, 'content', {
      get: () => {
        throw new Error('commit failed')
      },
    })
    expect(() => tree.commit(view)).toThrow('commit failed')
    expect(setup.renderer.root.getChildren()).toEqual([])
    expect(() => tree.commit(h.text('retry'))).toThrow('disposed')
  } finally {
    tree.dispose()
    setup.renderer.destroy()
  }
})
