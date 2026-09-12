import { Array, Option } from 'effect'

import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  MouseButton,
  type Renderable,
  TextRenderable,
} from '@opentui/core'

import type { View } from './view.js'

type Mounted<Message> = {
  view: View<Message>
  renderable: Renderable
  children: globalThis.Array<Mounted<Message>>
  release: () => void
}

export const createReconciler = <Message>(
  renderer: CliRenderer,
  dispatch: (message: Message) => void,
) => {
  const container = new BoxRenderable(renderer, {
    flexDirection: 'column',
    width: '100%',
  })
  try {
    renderer.root.add(container)
  } catch (error) {
    container.destroyRecursively()
    throw error
  }

  let roots: globalThis.Array<Mounted<Message>> = []
  let isCommitting = false
  let isDisposed = false
  const owned = new Set<Mounted<Message>>()

  const destroy = (mounted: Mounted<Message>): void => {
    if (!owned.delete(mounted)) {
      return
    }
    mounted.release()
    for (const child of mounted.children) {
      destroy(child)
    }
    if (!mounted.renderable.isDestroyed) {
      mounted.renderable.destroyRecursively()
    }
  }

  const mount = (view: View<Message>, parent: Renderable): Mounted<Message> => {
    const renderable =
      view._tag === 'Box'
        ? new BoxRenderable(renderer, {
            flexDirection: 'column',
            width: '100%',
          })
        : createLeaf(view)
    const mounted: Mounted<Message> = {
      view,
      renderable,
      children: [],
      release: () => {},
    }
    owned.add(mounted)
    parent.add(renderable)
    if (renderable instanceof InputRenderable) {
      const onInput = (value: string): void => {
        if (!isCommitting && !isDisposed && mounted.view._tag === 'Input') {
          dispatch(mounted.view.onInput(value))
        }
      }
      const onEnter = (): void => {
        if (
          !isCommitting &&
          !isDisposed &&
          mounted.view._tag === 'Input' &&
          mounted.view.onSubmit
        ) {
          dispatch(mounted.view.onSubmit())
        }
      }
      renderable.on('input', onInput)
      renderable.on('enter', onEnter)
      renderable.onMouseDown = event => {
        if (event.button === MouseButton.LEFT) {
          // NOTE: OpenTUI applies mouse autofocus after dispatch. Prevent it
          // so selection changes only when the Model commits isFocused.
          event.preventDefault()
          if (
            !isCommitting &&
            !isDisposed &&
            mounted.view._tag === 'Input' &&
            mounted.view.onFocus
          ) {
            dispatch(mounted.view.onFocus())
          }
        }
      }
      mounted.release = () => {
        renderable.off('input', onInput)
        renderable.off('enter', onEnter)
        renderable.onMouseDown = undefined
      }
    }
    if (view._tag === 'Button' && renderable instanceof BoxRenderable) {
      const label = new TextRenderable(renderer, {
        content: view.label,
        selectable: false,
      })
      renderable.add(label)
      renderable.onMouseDown = event => {
        if (
          event.button === MouseButton.LEFT &&
          !isCommitting &&
          !isDisposed &&
          mounted.view._tag === 'Button'
        ) {
          event.preventDefault()
          dispatch(mounted.view.onPress())
        }
      }
      mounted.release = () => {
        renderable.onMouseDown = undefined
      }
    }
    return mounted
  }

  const createLeaf = (
    view: Exclude<View<Message>, { _tag: 'Box' }>,
  ): Renderable => {
    if (view._tag === 'Text') {
      return new TextRenderable(renderer, { content: view.content })
    } else if (view._tag === 'Input') {
      return new InputRenderable(renderer, { value: view.value, width: '100%' })
    } else if (view._tag === 'Button') {
      return new BoxRenderable(renderer, {
        border: true,
        alignSelf: 'flex-start',
      })
    } else {
      return view satisfies never
    }
  }

  const reconcile = (
    parent: Renderable,
    previous: globalThis.Array<Mounted<Message>>,
    views: ReadonlyArray<View<Message>>,
  ): globalThis.Array<Mounted<Message>> => {
    const keyed = new Map(
      previous
        .filter(child => child.view.key !== undefined)
        .map(child => [child.view.key, child]),
    )
    const retained = new Set<Mounted<Message>>()
    const next = views.map((view, index) => {
      const candidate =
        view.key === undefined
          ? Option.getOrUndefined(Array.get(previous, index))
          : keyed.get(view.key)
      const mounted =
        candidate &&
        candidate.view.key === view.key &&
        candidate.view._tag === view._tag
          ? candidate
          : mount(view, parent)
      retained.add(mounted)
      mounted.view = view
      if (view._tag === 'Box' && mounted.renderable instanceof BoxRenderable) {
        mounted.renderable.padding = view.padding
        mounted.renderable.gap = view.gap
        mounted.children = reconcile(
          mounted.renderable,
          mounted.children,
          view.children,
        )
      }
      if (
        view._tag === 'Text' &&
        mounted.renderable instanceof TextRenderable
      ) {
        mounted.renderable.content = view.content
      }
      if (
        view._tag === 'Input' &&
        mounted.renderable instanceof InputRenderable
      ) {
        // NOTE: OpenTUI's value setter emits input and resets the cursor. Skip
        // equal writes to preserve editing position; commit suppresses setter events.
        if (mounted.renderable.value !== view.value) {
          mounted.renderable.value = view.value
        }
        mounted.renderable.placeholder = view.placeholder
      }
      if (
        view._tag === 'Button' &&
        mounted.renderable instanceof BoxRenderable
      ) {
        const maybeLabel = Array.head(mounted.renderable.getChildren())
        if (Option.isSome(maybeLabel)) {
          const label = maybeLabel.value
          if (label instanceof TextRenderable) {
            label.content = view.label
          }
        }
      }
      return mounted
    })

    for (const child of previous) {
      if (!retained.has(child)) {
        destroy(child)
      }
    }
    for (const [index, child] of next.entries()) {
      const current = Option.getOrUndefined(
        Array.get(parent.getChildren(), index),
      )
      if (current !== child.renderable) {
        parent.add(child.renderable, index)
      }
    }
    return next
  }

  const validate = (views: ReadonlyArray<View<Message>>): number => {
    const keys = new Set<string>()
    let focusedCount = 0
    for (const view of views) {
      if (view.key !== undefined) {
        if (keys.has(view.key)) {
          throw new Error(`Duplicate sibling key: ${view.key}`)
        }
        keys.add(view.key)
      }
      if (view._tag === 'Box') {
        focusedCount += validate(view.children)
      }
      if (view._tag === 'Input' && view.isFocused) {
        focusedCount += 1
      }
    }
    return focusedCount
  }

  const inputs = (
    nodes: globalThis.Array<Mounted<Message>>,
  ): globalThis.Array<Mounted<Message>> =>
    nodes.flatMap(node =>
      node.view._tag === 'Input' ? [node] : inputs(node.children),
    )

  const dispose = (): void => {
    if (isDisposed) {
      return
    }
    isDisposed = true
    for (const mounted of owned) {
      destroy(mounted)
    }
    roots = []
    container.destroyRecursively()
  }

  return {
    commit: (view: View<Message>): void => {
      if (isDisposed) {
        throw new Error('Cannot commit a disposed OpenTUI tree')
      }
      if (validate([view]) > 1) {
        throw new Error('Only one input may be focused')
      }
      isCommitting = true
      try {
        roots = reconcile(container, roots, [view])
        const mountedInputs = inputs(roots)
        for (const input of mountedInputs) {
          if (
            input.view._tag === 'Input' &&
            !input.view.isFocused &&
            input.renderable.focused
          ) {
            input.renderable.blur()
          }
        }
        for (const input of mountedInputs) {
          if (
            input.view._tag === 'Input' &&
            input.view.isFocused &&
            !input.renderable.focused
          ) {
            input.renderable.focus()
          }
        }
      } catch (error) {
        dispose()
        throw error
      } finally {
        isCommitting = false
      }
    },
    dispose,
  }
}
