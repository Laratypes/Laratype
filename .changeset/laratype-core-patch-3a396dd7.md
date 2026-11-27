---
"@laratype/core": patch
---

Use the contract's isStandardSchema in defineEnv. Type a ConfigValue path that is exactly a reserved key (constructor, prototype, __proto__) as undefined, also below an unknown key, and a dotted remainder such as `b.constructor` as unknown, since the runtime reads it as a whole key.
