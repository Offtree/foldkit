import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'

import { createView } from '../src/index.js'

// MODEL

const Status = defineTaggedUnion({
  Editing: {},
  Rejected: { reason: Schema.String },
  Submitted: {},
})
type Status = typeof Status.Type

export const Model = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  focusedField: Schema.Literals(['Name', 'Email']),
  status: Status,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedName: { value: Schema.String },
  UpdatedEmail: { value: Schema.String },
  PressedNextField: {},
  PressedSubmit: {},
  SelectedNameField: {},
  SelectedEmailField: {},
})
export type Message = typeof Message.Type

// INIT

export const init = (): Update.Return<Model, Message> => ({
  model: {
    name: '',
    email: '',
    focusedField: 'Name',
    status: Status.Editing(),
  },
})

// UPDATE

const returnToEditing = (status: Status): Status =>
  status._tag === 'Editing' ? status : Status.Editing()

const rejectWith = (model: Model, reason: string) => ({
  model: evo(model, { status: () => Status.Rejected({ reason }) }),
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedName: ({ value }) => ({
      model: evo(model, { name: () => value, status: returnToEditing }),
    }),
    UpdatedEmail: ({ value }) => ({
      model: evo(model, { email: () => value, status: returnToEditing }),
    }),
    PressedNextField: () => ({
      model: evo(model, {
        focusedField: field => (field === 'Name' ? 'Email' : 'Name'),
      }),
    }),
    SelectedNameField: () => ({
      model: evo(model, { focusedField: () => 'Name' }),
    }),
    SelectedEmailField: () => ({
      model: evo(model, { focusedField: () => 'Email' }),
    }),
    PressedSubmit: () => {
      if (model.name === '') {
        return rejectWith(model, 'Name is required.')
      }
      if (!model.email.includes('@')) {
        return rejectWith(model, 'Enter a valid email address.')
      }
      return { model: evo(model, { status: () => Status.Submitted() }) }
    },
  })

// VIEW

const h = createView<Message>()

const statusText = (status: Status) =>
  Status.match<string>(status, {
    Editing: () => 'Fill the fields, then submit.',
    Rejected: ({ reason }) => reason,
    Submitted: () => 'Submitted. Ctrl+C quits.',
  })

export const view = (model: Model) =>
  h.box({ padding: 1, gap: 1 }, [
    h.text('Foldkit | Sign-up form'),
    h.text('Name'),
    h.input({
      key: 'name',
      value: model.name,
      isFocused: model.focusedField === 'Name',
      placeholder: 'Ada Lovelace',
      onInput: value => Message.UpdatedName({ value }),
      onFocus: () => Message.SelectedNameField(),
      onSubmit: () => Message.PressedSubmit(),
    }),
    h.text('Email'),
    h.input({
      key: 'email',
      value: model.email,
      isFocused: model.focusedField === 'Email',
      placeholder: 'ada@example.com',
      onInput: value => Message.UpdatedEmail({ value }),
      onFocus: () => Message.SelectedEmailField(),
      onSubmit: () => Message.PressedSubmit(),
    }),
    h.text(statusText(model.status)),
    h.button({ label: 'Submit', onPress: () => Message.PressedSubmit() }),
    h.text('Ctrl+N: next field • Enter: submit • Ctrl+C: quit'),
  ])
