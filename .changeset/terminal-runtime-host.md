---
'foldkit': minor
---

Add an experimental scoped host runtime at `foldkit/experimental/runtime` for non-browser renderers. It shares Message processing, Model transitions, Command execution, Subscriptions, and ManagedResource lifecycle machinery with the browser runtime. Hosts supply render commits and scheduling, and acquire their renderer through Effect scopes.
