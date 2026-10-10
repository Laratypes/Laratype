---
area: validation
packages: ["@laratype/contract", "@laratype/validation", "@laratype/http"]
issues: [91, 106, 137]
verified-against: Laratype@d70daa7 (+ PR #205 @ 8791758)
last-verified: 2026-10-09
---

# Validation

v1 validates requests against the contract's Standard Schema slots (query, body, headers). The schema-agnostic primitive lives in `@laratype/contract`. Running it in the request pipeline belongs to `@laratype/http` (H3), and Laravel-style request classes belong to `@laratype/validation` (H10). `@laratype/validation` on master is still the 0.5 package.

| Section | Status |
|---|---|
| [Standard Schema adapter](#standard-schema-adapter) | proposed: PR #205 @ 8791758 |
| [Pipeline validation and 422](#pipeline-validation-and-422) | planned → #106 |
| [FormRequest v2](#formrequest-v2) | planned → #137 |

---

## Standard Schema adapter

### Status
proposed: PR #205 @ 8791758 (C3 [#91](https://github.com/Laratypes/Laratype/issues/91)).

### Public API
Specified in full in [contract.md › Validation adapter](./contract.md#validation-adapter). It is not repeated here, so the two copies can't drift. In summary: `validate(schema, value)` and `validateSync(schema, value)` return `ValidationResult<O>`, `toErrorBag(issues)` builds an `ErrorBag`, and the `StandardIssue` type is exported.

### Invariants
- Invalid input resolves to `{ ok: false, errors, issues }` and never rejects.
- `ErrorBag` maps dot paths to messages. It has a null prototype, and issues without a path go under `""`.
- The `errors` bag has exactly the shape of the 422 body, `ValidationErrorBody.errors` ([contract.md › Error catalog](./contract.md#error-catalog)).

### Diagnostics
See [contract.md › Validation adapter](./contract.md#validation-adapter).

### Example
[`examples/contract/proposed/validate.ts`](./examples/contract/proposed/validate.ts)

### Non-goals
- No messages, i18n, `authorize()` or DB rules at this layer.

### Open questions
- None recorded.

### Acceptance
[#91 Done when](https://github.com/Laratypes/Laratype/issues/91)

---

## Pipeline validation and 422

### Status
planned → [#106](https://github.com/Laratypes/Laratype/issues/106) (H3). The spec for the pipeline as a whole is in [http.md › Request pipeline](./http.md#request-pipeline).

### Design (non-binding)
- **Parsing (#106):** params, query and body are parsed by contract (JSON, form, multipart), and query values are coerced.
- **Validation:** each slot goes through `validate()` (C3). On failure the response is **422** with the `errors.validation` body, `{ message, errors: ErrorBag }`.
- **Context:** the handler context is built from the validated **output** types (`InferOut`), so handlers see coerced and defaulted values.
- **Done when:** runtime tests cover valid input, invalid input (422) and coercion.

### Acceptance
[#106 Done when](https://github.com/Laratypes/Laratype/issues/106)

---

## FormRequest v2

### Status
planned → [#137](https://github.com/Laratypes/Laratype/issues/137) (H10, M3).

### Design (non-binding)
- **Base class (#137):** `FormRequest<typeof users.store>`, with `authorize()` and `messages()`. Message keys are inferred from the schema.
- **Async rules:** for example a unique email, run as async refinements.
- **i18n:** messages through `@laratype/i18n` ([#167](https://github.com/Laratypes/Laratype/issues/167)).
- **Rules:** the rules default to the contract's body schema. FormRequest only **adds** authorization, messages and async rules, and never redefines the schema.
- **Pipeline position:** after route guards and policies, and before validation (see [http.md › Request pipeline](./http.md#request-pipeline)).

### Acceptance
[#137 Done when](https://github.com/Laratypes/Laratype/issues/137)
