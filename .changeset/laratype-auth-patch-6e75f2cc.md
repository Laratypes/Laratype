---
"@laratype/auth": patch
---

D11 #318: the guard container comes from the request store, not ContextApi.getContainer(), so a facade application outside a request is never used as a request container.
