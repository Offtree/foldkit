# Foldkit OpenTUI adapter

Private, source-only workspace prototype for declarative terminal views. It runs on Bun with OpenTUI 0.5.11 and `foldkit/experimental/runtime`.

## Run the editable list

From the Foldkit checkout, after `pnpm install` and building Foldkit:

```sh
pnpm --filter @foldkit-internal/opentui dev
```

Type to edit the focused item. Tab selects the next item. Ctrl+R reverses the list, Ctrl+N adds an item, Ctrl+D removes the selected item, and Ctrl+C quits. Reversing preserves the focused input and its cursor position.

Run its native renderer tests with `bun test` from `internal/foldkit-opentui`.

## Run the form

The form exercises controlled inputs, Enter submission, validation Messages, Model-driven focus, and a clickable button:

```sh
pnpm --filter @foldkit-internal/opentui form
```

Ctrl+N moves to the next field, Enter submits from either input, and Ctrl+C quits.

## Views and Messages

`createView<Message>()` returns Schema-backed `box`, `text`, `input`, and `button` builders. A view is a pure Model-to-tree function. Widget handlers produce Messages; the host dispatches them to Foldkit's update function.

```ts
const h = createView<Message>()

const view = (model: Model) =>
  h.box({ padding: 1 }, [
    h.text('Name'),
    h.input({
      value: model.name,
      isFocused: true,
      onInput: value => Message.UpdatedName({ value }),
    }),
  ])
```

Boxes lay out children vertically and accept `padding` and `gap`. Text accepts string content. Inputs accept a controlled `value`, `placeholder`, `isFocused`, `onInput`, and optional `onFocus` and `onSubmit`. Enter invokes `onSubmit`. Omitted options reset to builder defaults on the next commit. At most one input can request focus. A mouse click requests focus through `onFocus`; update decides whether to change selection. Without a handler, clicks cannot move focus outside the Model.

Buttons accept a label and `onPress`. They render as bordered boxes and dispatch their Message on a left-button press. OpenTUI has no dedicated button renderable in the pinned version, so keyboard button focus and activation are not part of this prototype yet.

Use `key` for an entity's stable Model identifier. Keys are sibling-local; duplicate sibling keys fail before mutation. A matching kind and key reuse the native node. A changed kind replaces it. Moving a keyed box preserves its descendants, input focus, and cursor. Event handlers refresh on every commit. Model-driven value changes do not emit Messages, and unchanged values do not reset the cursor. The host requests a commit after widget Messages, including rejected edits that leave the Model reference unchanged.

The run scripts preload Foldkit's view-identity transform through Bun. Extract conditional arms into view functions, just as in a browser Foldkit application. Switching between two same-kind unkeyed branches then replaces the old native subtree. Build identity stays separate from entity keys.

## Host ownership

`makeHost({ acquireRenderer, view, onKey? })` plugs into `Runtime.run`. The runtime owns its scoped host, which owns the renderer, reconciler, and keyboard listeners. Shutdown removes listeners and releases native nodes before destroying the renderer. Pending commits use cancellable `setImmediate` scheduling. A failed native commit disposes the tree and propagates the defect to the runtime.

The optional `onKey` hook handles application shortcuts. Call `key.preventDefault()` for a consumed key so the focused input does not also process it. Keep edits and selection in the Model, as the editable-list example does.

## Current scope

This prototype has positional, entity-key, and build-generated view-function identity. It has no terminal Mount API, Submodel Message mapping helper, lazy views, or widgets beyond boxes, text, inputs, and mouse-activated buttons. The package stays private while these boundaries are developed.
