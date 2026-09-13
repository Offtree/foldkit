import { Schema } from 'effect'
import { viewIdentityKey } from 'foldkit/brand'
import { taggedStruct } from 'foldkit/schema'

type Identity = Readonly<{ [viewIdentityKey]?: string }>

export const createView = <Message>() => {
  const key = Schema.optional(Schema.String)
  const Text = taggedStruct('Text', {
    key,
    content: Schema.String,
  })
  const Input = taggedStruct('Input', {
    key,
    value: Schema.String,
    isFocused: Schema.Boolean,
    placeholder: Schema.String,
    onInput: Schema.declare<(value: string) => Message>(
      (value): value is (value: string) => Message =>
        typeof value === 'function',
    ),
    onFocus: Schema.optional(
      Schema.declare<() => Message>(
        (value): value is () => Message => typeof value === 'function',
      ),
    ),
    onSubmit: Schema.optional(
      Schema.declare<() => Message>(
        (value): value is () => Message => typeof value === 'function',
      ),
    ),
  })
  const Button = taggedStruct('Button', {
    key,
    label: Schema.String,
    onPress: Schema.declare<() => Message>(
      (value): value is () => Message => typeof value === 'function',
    ),
  })
  type Box = Readonly<{
    _tag: 'Box'
    key?: string
    padding: number
    gap: number
    children: ReadonlyArray<Node>
  }>
  type Node =
    | (typeof Text.Type & Identity)
    | (typeof Input.Type & Identity)
    | (typeof Button.Type & Identity)
    | (Box & Identity)
  const Box = taggedStruct('Box', {
    key,
    padding: Schema.Number,
    gap: Schema.Number,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)),
  })
  const Node: Schema.Codec<Node> = Schema.Union([Text, Input, Button, Box])
  const withIdentity = <A extends object>(node: A): A & Identity => {
    Object.defineProperty(node, viewIdentityKey, {
      configurable: true,
      value: undefined,
      writable: true,
    })
    return node
  }
  const makeBox = (
    options: Readonly<{ key?: string; padding?: number; gap?: number }>,
    children: ReadonlyArray<Node>,
  ): Node => {
    const node = Box({ padding: 0, gap: 0, ...options, children })
    Object.defineProperty(node, 'children', {
      configurable: true,
      enumerable: true,
      value: children,
      writable: true,
    })
    return withIdentity(node)
  }

  return {
    Node,
    text: (content: string, options: Readonly<{ key?: string }> = {}): Node =>
      withIdentity(Text({ content, ...options })),
    input: (
      options: Readonly<{
        key?: string
        value: string
        isFocused?: boolean
        placeholder?: string
        onInput: (value: string) => Message
        onFocus?: () => Message
        onSubmit?: () => Message
      }>,
    ): Node =>
      withIdentity(Input({ isFocused: false, placeholder: '', ...options })),
    button: (
      options: Readonly<{
        key?: string
        label: string
        onPress: () => Message
      }>,
    ): Node => withIdentity(Button(options)),
    box: (
      options: Readonly<{ key?: string; padding?: number; gap?: number }>,
      children: ReadonlyArray<Node> = [],
    ): Node => makeBox(options, children),
  }
}

export type View<Message> = ReturnType<
  typeof createView<Message>
>['Node']['Type']
