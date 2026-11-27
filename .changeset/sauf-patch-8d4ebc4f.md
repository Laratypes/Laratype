---
"sauf": patch
---

Bump @rollup/plugin-terser to ^1.0.2 so sauf's serialize-javascript dependency edge moves to the 7.x line instead of the vulnerable 6.x line; the plugin declares ^7.0.3 and this workspace resolves 7.1.4, while a consumer's exact version follows its own lock
