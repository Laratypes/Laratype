---
"@laratype/contract": patch
---

Group a constrained param alternation the way Hono 4.13.23 groups it in TrieRouter, and keep refusing a split when either trie form reads it differently from the RegExp form (GHSA-586x-c76g-h528)
