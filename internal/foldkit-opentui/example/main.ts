import { Array, Option, Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'

import { createView } from '../src/index.js'

const Item = Schema.Struct({ id: Schema.Number, label: Schema.String })
export const Model = Schema.Struct({
  items: Schema.NonEmptyArray(Item),
  selectedId: Schema.Number,
  nextId: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  UpdatedLabel: { id: Schema.Number, value: Schema.String },
  PressedReverse: {},
  PressedAdd: {},
  PressedRemove: {},
  PressedNext: {},
  RequestedFocus: { id: Schema.Number },
})
export type Message = typeof Message.Type

export const init = (): Update.Return<Model, Message> => ({
  model: {
    items: [
      { id: 1, label: 'First' },
      { id: 2, label: 'Second' },
    ],
    selectedId: 1,
    nextId: 3,
  },
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedLabel: ({ id, value }) => ({
      model: evo(model, {
        items: Array.map(item =>
          item.id === id ? evo(item, { label: () => value }) : item,
        ),
      }),
    }),
    PressedReverse: () => ({ model: evo(model, { items: Array.reverse }) }),
    PressedAdd: () => ({
      model: evo(model, {
        items: items => [...items, { id: model.nextId, label: '' }],
        selectedId: () => model.nextId,
        nextId: nextId => nextId + 1,
      }),
    }),
    PressedRemove: () => {
      if (model.items.length <= 1) {
        return { model }
      }
      const nextItems = model.items.filter(item => item.id !== model.selectedId)
      if (!Array.isArrayNonEmpty(nextItems)) {
        return { model }
      }
      return {
        model: evo(model, {
          items: () => nextItems,
          selectedId: () => Array.headNonEmpty(nextItems).id,
        }),
      }
    },
    PressedNext: () => {
      const nextItem = Array.findFirstIndex(
        model.items,
        item => item.id === model.selectedId,
      ).pipe(
        Option.flatMap(index => Array.get(model.items, index + 1)),
        Option.getOrElse(() => Array.headNonEmpty(model.items)),
      )
      return { model: evo(model, { selectedId: () => nextItem.id }) }
    },
    RequestedFocus: ({ id }) => ({
      model: evo(model, { selectedId: () => id }),
    }),
  })

const h = createView<Message>()

export const view = (model: Model) =>
  h.box({ padding: 1, gap: 1 }, [
    h.text('Foldkit | Editable keyed list'),
    h.text(
      'Tab: next • Ctrl+R: reverse • Ctrl+N: add • Ctrl+D: remove • Ctrl+C: quit',
    ),
    h.box(
      { gap: 1 },
      model.items.map(item =>
        h.box({ key: globalThis.String(item.id) }, [
          h.text(`Item ${item.id}`),
          h.input({
            value: item.label,
            isFocused: item.id === model.selectedId,
            placeholder: 'Type a label',
            onInput: value => Message.UpdatedLabel({ id: item.id, value }),
            onFocus: () => Message.RequestedFocus({ id: item.id }),
          }),
        ]),
      ),
    ),
  ])
