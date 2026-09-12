---
'@foldkit/vite-plugin': patch
---

Include `effect/Deferred` in the dev-server prebundle so the experimental runtime entry imports without crashing under Vite's dependency optimizer.
