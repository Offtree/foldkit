# Experimental host runtime

`foldkit/experimental/runtime` runs Foldkit application logic with a non-browser rendering host. This is the first runtime extraction for terminal adapters.

The browser runtime and this runtime both use `runtime/execution.ts` for Model transitions and Command execution. They also share `messageQueue.ts`, `resourceProvider.ts`, `subscriptionFibers.ts`, and `managedResourceFibers.ts`. Browser startup, hydration, rendering, and DevTools stay in the browser runtime.

## Host boundary

A host receives `dispatch(Message)`, `requestCommit()`, and `stop()` callbacks, then returns a scoped Effect producing:

- `commit(Model)`: synchronously update its render tree from the latest Model.
- `scheduleCommit(callback)`: schedule an asynchronous callback and return a function that cancels it. Invoke each scheduled callback at most once.

The host owns its view builder, renderable identity, renderer, and input listeners. Acquire resources with `Effect.acquireRelease` inside the host Effect. Foldkit closes that scope on host stop, interruption, or failure.

Call `requestCommit()` after a native widget dispatches an edit to restore the latest Model value even if update rejects the edit and keeps the same Model reference. It coalesces with pending Model-driven commits, uses the same cancellation and failure handling, and does not publish a Model transition. The initial commit covers acquisition-time requests. Requests after stop or failure are ignored.

See `internal/opentui-counter` for an executable host using `@opentui/core`. Its view returns text and the host updates one persistent text renderable. `internal/foldkit-opentui` provides the private declarative adapter and an editable-list example.

## Execution guarantees

1. Host events buffer during startup. The initial commit sees the initial Model.
2. Subscription and ManagedResource Model-change listeners attach before buffered Messages drain.
3. Messages process in arrival order. Reentrant dispatches buffer; commit-time events wait until the commit finishes.
4. Command starts defer to a microtask and run in the runtime's Effect scope. Their result Messages enter the same queue.
5. Model changes coalesce into one pending host commit. Every Model transition still reaches Subscription and ManagedResource dependency tracking.
6. Shutdown gates dispatch before interrupting lifecycle fibers and releasing the host. Pending host commits are cancelled.
7. Update, scheduling, commit, and background defects fail the runtime Effect. Its scope closes before the caller observes completion.

The terminal failure policy closes the runtime, whereas the browser runtime can keep a crash view visible until disposal.

## Current scope

Application logic may use platform-independent Commands, Subscriptions, ManagedResources, and shared Effect services through the `resources` Layer. Resolve Flags before calling `run`; this first API accepts a zero-argument init function.

Browser-specific modules such as `Dom`, HTML Mounts, navigation, `Render.afterCommit`, and `Render.afterPaint` retain their browser contracts. In particular, the Render helpers may request animation frames and are not terminal APIs. A host commit updates its render tree; it does not establish that terminal output has been painted.

This entry point does not yet provide browser DevTools, Ports, Model preservation, or build-generated view identity. Those need explicit host designs before they can be exposed here.
