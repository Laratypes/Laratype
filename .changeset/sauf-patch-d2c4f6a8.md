---
"sauf": patch
---

sauf build requires outDir; unknown or version-skew tsconfig options only warn; a .js next to its .ts is skipped as tsc output (in place) or stale output (with a separate outDir, with a warning) and no longer restarts sauf dev --hmr
