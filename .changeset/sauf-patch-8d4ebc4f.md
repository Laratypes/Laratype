---
"sauf": patch
---

Bump @rollup/plugin-terser to ^1.0.2, which moves sauf's serialize-javascript dependency off the 6.x line to ^7.0.3. serialize-javascript advisories reach 7.1.2 (GHSA-m5mm-p8h7-m29v), so consumers should resolve 7.1.3 or later; this workspace resolves 7.1.4
