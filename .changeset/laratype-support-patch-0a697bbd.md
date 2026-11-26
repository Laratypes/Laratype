---
"@laratype/support": patch
---

D11 #318: ContextApi.getContainer() returns the request container, else the app container, so it is never undefined; the facade and http share one fallback.
