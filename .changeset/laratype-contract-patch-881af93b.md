---
"@laratype/contract": patch
---

Group a constrained param alternation the way Hono 4.13.23 groups it in TrieRouter, so buildUrl sends a split both routers read whole instead of refusing it (GHSA-586x)
