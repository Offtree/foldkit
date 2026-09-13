import type { VNode } from '../snabbdom/index.js'

/**
 * Framework-managed identity used by non-DOM view adapters.
 *
 * Define this property on an adapter view node, initially with an undefined
 * value, to let Foldkit's build transform stamp the function that returned it.
 */
export const viewIdentityKey = Symbol.for('foldkit/view-identity')

type ViewIdentityTarget = Readonly<{
  [viewIdentityKey]?: string
}>

const isVNode = (value: unknown): value is VNode =>
  typeof value === 'object' &&
  value !== null &&
  'sel' in value &&
  typeof value.sel === 'string' &&
  'data' in value &&
  'children' in value &&
  'text' in value &&
  'elm' in value &&
  'key' in value

const isViewIdentityTarget = (value: unknown): value is ViewIdentityTarget =>
  typeof value === 'object' && value !== null && viewIdentityKey in value

const stampIdentity = (target: VNode, identity: string): void => {
  if (target.identity === undefined) {
    target.identity = identity
  }
}

const stampViewIdentity = (
  target: ViewIdentityTarget,
  identity: string,
): void => {
  if (target[viewIdentityKey] === undefined) {
    Reflect.set(target, viewIdentityKey, identity)
  }
}

const stampResult = (result: unknown, identity: string): void => {
  if (isVNode(result)) {
    stampIdentity(result, identity)
  } else if (isViewIdentityTarget(result)) {
    stampViewIdentity(result, identity)
  }
}

/**
 * Stamps a framework-managed identity onto a view result.
 *
 * Identity is the differ's second axis, independent of user-facing keys: it
 * answers "which view arm produced this node" rather than "which sibling is
 * this". Identity never enters the keyed index; it joins the differ's
 * compatibility check exactly where the selector is consulted, so an identity
 * mismatch replaces the node instead of patching it, and switching between
 * conditional view arms tears down the old subtree even when both arms render
 * the same tag.
 *
 * Stamping is set-if-absent and mutates the view node in place: a node that
 * already carries an identity (including a memoized node returned from a
 * cache) is left untouched, so branding is idempotent and never breaks
 * reference equality that the renderer relies on. DOM vnodes and non-DOM
 * adapter nodes carrying {@link viewIdentityKey} are stamped directly; for an
 * array result each supported node is stamped with the same identity. Any
 * other value passes through unchanged.
 *
 * `@foldkit/vite-plugin` injects a call to this around every function return
 * in application modules at build time, so identity attaches at view-function
 * boundaries regardless of the branching syntax that selected the function.
 * Application code does not call it by hand.
 */
export const brandViewResult = <A>(result: A, identity: string): A => {
  if (Array.isArray(result)) {
    for (const element of result) {
      stampResult(element, identity)
    }
  } else {
    stampResult(result, identity)
  }
  return result
}
