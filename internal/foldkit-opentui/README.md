# Foldkit OpenTUI adapter

Private, source-only workspace prototype for declarative terminal views. It runs on Bun with OpenTUI 0.5.11 and `foldkit/experimental/runtime`.

## Run the editable list

From the Foldkit checkout, after `pnpm install` and building Foldkit:

```sh
pnpm --filter @foldkit-internal/opentui dev
```

Type to edit the focused item. Tab selects the next item. Ctrl+R reverses the list, Ctrl+N adds an item, Ctrl+D removes the selected item, and Ctrl+C quits. Reversing preserves the focused input and its cursor position.

Run its native renderer tests with `bun test` from `internal/foldkit-opentui`.

## Views and Messages

`createView<Message>()` returns Schema-backed `box`, `text`, and `input` builders. A view is a pure Model-to-tree function. Input handlers produce Messages; the host dispatches them to Foldkit's update function.

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

Boxes lay out children vertically and accept `padding` and `gap`. Text accepts string content. Inputs accept a controlled `value`, `placeholder`, `isFocused`, `onInput`, and optional `onFocus`. Omitted options reset to builder defaults on the next commit. At most one input can request focus. A mouse click requests focus through `onFocus`; update decides whether to change selection. Without a handler, clicks cannot move focus outside the Model.

Use `key` for an entity's stable Model identifier. Keys are sibling-local; duplicate sibling keys fail before mutation. A matching kind and key reuse the native node. A changed kind replaces it. Unkeyed nodes use their sibling position. Moving a keyed box preserves its descendants, input focus, and cursor. Event handlers refresh on every commit. Model-driven value changes do not emit Messages, and unchanged values do not reset the cursor. The host requests a commit after widget Messages, including rejected edits that leave the Model reference unchanged.

## Host ownership

`makeHost({ acquireRenderer, view, onKey? })` plugs into `Runtime.run`. The runtime owns its scoped host, which owns the renderer, reconciler, and keyboard listeners. Shutdown removes listeners and releases native nodes before destroying the renderer. Pending commits use cancellable `setImmediate` scheduling. A failed native commit disposes the tree and propagates the defect to the runtime.

The optional `onKey` hook handles application shortcuts. Call `key.preventDefault()` for a consumed key so the focused input does not also process it. Keep edits and selection in the Model, as the editable-list example does.

## Current scope

This prototype has positional and explicit entity-key identity. Build-generated view-function identity is not integrated with the Bun entry yet. Same-kind unkeyed branches reuse native state, so it does not yet provide Foldkit's browser branch-reset semantics. It also has no terminal Mount API, Submodel Message mapping helper, lazy views, or widgets beyond boxes, text, and inputs. The package stays private while these boundaries are developed.
