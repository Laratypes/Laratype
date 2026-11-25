---
"@laratype/auth": patch
---

Fail boot in PassportGuard.register() when the guard's options.passwordField differs from the provider model's static passwordField, instead of failing every attempt().
