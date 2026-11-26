---
"@laratype/i18n": patch
---

D11 #318: the translator and LocaleMiddleware read the request store, so an app-level Locale is ignored outside a request.
