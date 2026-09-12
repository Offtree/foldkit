---
'foldkit': minor
---

Add `Controls.requestCommit` to the experimental host runtime so controlled native widgets can restore Model values after rejected edits, even when update keeps the same Model reference. Requests share the runtime's coalesced, cancellable commit scheduling.
