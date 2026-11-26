---
"@laratype/http": minor
---

Typed implicit and scoped route model binding (H14 #163): a path param named after a registered model key binds that model, `.scopeBindings()` scopes a child lookup by its parent's relation, `Model.findByRouteKey()` takes the scope, and `sauf types:generate` writes `models.d.ts`.
