---
"@laratype/core": patch
---

D10 #298: re-check the request scope after the bubbling warning before caching, and make the no-metadata constructor scan skip a heritage class expression so the subclass constructor decides the count, with `cls.length` as its lower bound.
