import { Schema } from 'effect'
import { taggedStruct } from 'foldkit/schema'

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
  type Node = typeof Text.Type | typeof Input.Type | typeof Button.Type | Box
  const Box = taggedStruct('Box', {
    key,
    padding: Schema.Number,
    gap: Schema.Number,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)),
  })
  const Node: Schema.Codec<Node> = Schema.Union([Text, Input, Button, Box])

  return {
    Node,
    text: (content: string, options: Readonly<{ key?: string }> = {}): Node =>
      Text({ content, ...options }),
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
    ): Node => Input({ isFocused: false, placeholder: '', ...options }),
    button: (
      options: Readonly<{
        key?: string
        label: string
        onPress: () => Message
      }>,
    ): Node => Button(options),
    box: (
      options: Readonly<{ key?: string; padding?: number; gap?: number }>,
      children: ReadonlyArray<Node> = [],
    ): Node => Box({ padding: 0, gap: 0, ...options, children }),
  }
}

export type View<Message> = ReturnType<
  typeof createView<Message>
>['Node']['Type']
