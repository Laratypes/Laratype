---
area: validation
packages: ["@laratype/contract", "@laratype/validation", "@laratype/http"]
issues: [91, 106, 137, 287]
verified-against: Laratype@883a8e2
last-verified: 2026-10-12
---

# Validation

v1 validates requests against the contract's Standard Schema slots: query and body (a headers schema is not enforced yet). The schema-agnostic primitive lives in `@laratype/contract`. Running it in the request pipeline belongs to `@laratype/http` (H3), and Laravel-style request classes belong to `@laratype/validation` (H10). `@laratype/validation` on master is still the 0.5 package.

| Section | Status |
|---|---|
| [Standard Schema adapter](#standard-schema-adapter) | merged @ 883a8e2 |
| [Pipeline validation and 422](#pipeline-validation-and-422) | proposed: PR [#345](https://github.com/Laratypes/Laratype/pull/345) @ 1ad388b |
| [FormRequest v2](#formrequest-v2) | planned → #137 |

---

## Standard Schema adapter

### Status
merged @ 883a8e2 (C3 [#91](https://github.com/Laratypes/Laratype/issues/91)).

### Public API
Specified in full in [contract.md › Validation adapter](./contract.md#validation-adapter). It is not repeated here, so the two copies can't drift. In summary: `validate(schema, value)` and `validateSync(schema, value)` return `ValidationResult<O>`, `toErrorBag(issues)` builds an `ErrorBag`, and the `StandardIssue` type is exported.

### Invariants
- Invalid input resolves to `{ ok: false, errors, issues }` and never rejects.
- `ErrorBag` maps dot paths to messages. It has a null prototype, and issues without a path go under `""`.
- The `errors` bag has exactly the shape of the 422 body, `ValidationErrorBody.errors` ([contract.md › Error catalog](./contract.md#error-catalog)).

### Diagnostics
See [contract.md › Validation adapter](./contract.md#validation-adapter).

### Example
[`examples/contract/validate.ts`](./examples/contract/validate.ts)

### Non-goals
- No messages, i18n, `authorize()` or DB rules at this layer.

### Open questions
- None recorded.

### Acceptance
[#91 Done when](https://github.com/Laratypes/Laratype/issues/91)

---

## Pipeline validation and 422

### Status
proposed: PR [#345](https://github.com/Laratypes/Laratype/pull/345) @ 1ad388b (H3 [#106](https://github.com/Laratypes/Laratype/issues/106), H26 [#287](https://github.com/Laratypes/Laratype/issues/287), H43 [#340](https://github.com/Laratypes/Laratype/issues/340)). The spec for the pipeline as a whole is in [http.md › Request pipeline](./http.md#request-pipeline).

### Public API
No new export: `RequestKernel.handle` runs it for every `Route.api` contract route, and the handler gets the ctx (an [ad-hoc route](./http.md#ad-hoc-routes) has no contract: its body is parsed as below, a malformed one is the same 400, but nothing is validated and its handler gets the 0.5 request) typed by `Ctx<E>` ([http.md › Controller typing](./http.md#controller-typing-ctx-and-controllerof)). Code: [`request/input.ts` @ 1ad388b](https://github.com/Laratypes/Laratype/blob/1ad388becaf4765f6586e866a926f53b3e386bc0/packages/http/src/request/input.ts), [`request/Request.ts` @ 1ad388b](https://github.com/Laratypes/Laratype/blob/1ad388becaf4765f6586e866a926f53b3e386bc0/packages/http/src/request/Request.ts#L286) (`RequestKernel`), [`routing/api/proof.ts` @ 1ad388b](https://github.com/Laratypes/Laratype/blob/1ad388becaf4765f6586e866a926f53b3e386bc0/packages/http/src/routing/api/proof.ts#L23-L45).

```ts
// @laratype/http (RequestKernel is the default export of request/Request.ts)
class RequestKernel { static handle(routeOption: RouteParams): (ctx: Context) => Promise<void> }   // throws a TypeError for a contract route with a request class
export type BaseCtx<E extends AnyEndpoint, P = PathParams<E path>> = {
  readonly endpoint: E;
  params: P;                        // raw path params (strings)
  query: InferOut<E query schema>;  // undefined without one
  body: InferOut<E body schema>;    // undefined without one
};
export type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // BaseCtx<E> merged with Requires, params one level deep
```

### Invariants
- **Body by media type:** `application/json` and `application/*+json`, with any parameters (`; charset=utf-8`), the OWS RFC 9110 §8.3.1 allows before the `;` included (`application/json ; charset=utf-8`), and in any case; the vendor subtype may hold `_` (`application/vnd.my_app+json`, RFC 6838). That is Hono's `validator('json')` media type, with the `i` flag and digits in the vendor prefix too (`application/vnd.github.v3+json`). Anything else goes to Hono's `parseBody({ dot: true })`: `multipart/form-data` and `x-www-form-urlencoded` fields (`user.age` becomes `{ user: { age } }`), `{}` for other types. A multipart file field is the standard web `File`, so contracts stay browser-safe.
- **Malformed bodies** are a **400**, on 0.5 and `Route.api` routes alike, never a 500: JSON as `{ message: "Malformed JSON in request body." }`; a form body `parseBody()` rejects (a missing or bad multipart boundary, a truncated part) as `{ message: "Malformed form data in request body." }`. A read of the body stream that fails is that same 400 for its media type, whatever the request's signal says: `@hono/node-server` aborts it on close, but a truncated body can arrive without one, and it is never logged at error level. Hono's `bodyLimit` keeps its own **413**: it errors the stream with a `BodyLimitError`, and the pipeline rethrows it untouched. A body an earlier middleware read through Hono's readers is served from Hono's cache, a 200: its `c.req.parseBody()` or `validator('form')` FormData, its `c.req.arrayBuffer()` bytes, or its `c.req.text()`. The pipeline converts the cached FormData with its own options, so a flat `c.req.parseBody()` does not hide dot keys, and a `c.req.parseBody()` on a JSON request caches `{}` without reading the stream, so the JSON body is read off `c.req.raw`. The one reader a multipart body cannot be rebuilt from is `c.req.text()`: it keeps characters, not the bytes of a file part, so that state is the generic 500, with its own message (a urlencoded body is text by definition, so its text is its body). A body read off `c.req.raw` directly, which leaves the cache empty (`raw.bodyUsed`), is that 500 too, a server bug. Form and JSON follow the same rules. An empty (or whitespace-only) body is no body, `{}` for the JSON and the form types alike, so a client that sends its `Content-Type` on a GET or a DELETE with no body still gets through: the form path reads the body's bytes to tell blank ones from a body (`formData()` rejects an empty multipart body).
- **Query:** a key sent once is a string, a repeated key an array (how `buildUrl` sends an array). A single value for an array schema (`?tag=a` for `z.array(z.string())`) is a string, so such a schema accepts both (`z.union` or a preprocess). Converting a value is the schema's job: `z.coerce.number<number>()` (zod 4) or `z.coerce.number()` (zod 3) turns `"2"` into `2`, and defaults apply.
- **Params** are the raw path params (strings), folder params included. Converting them is `r.bind()` (H7 [#118](https://github.com/Laratypes/Laratype/issues/118)).
- **Validation:** the endpoint's `query` and `body` schemas go through the contract's `validate()` (C3), in that order, after middleware and policies and before the handler. The body itself is read at the start of `RequestKernel.handle`, before the route middleware, so a middleware that needs the raw stream must run before the kernel (`app.use()`). A contract route takes no 0.5 request class: `RequestKernel.handle` with both an `endpoint` and a `request` throws (see Diagnostics).
- **422:** invalid input in the query, the body or both answers **422** with the catalog `errors.validation` body and its code, `{ code: "VALIDATION_ERROR", message: "The given data was invalid.", errors: ErrorBag }`, one bag for both slots (dot paths, unprefixed). Until H5 [#108](https://github.com/Laratypes/Laratype/issues/108) maps a thrown `ContractError`, it is sent as a Hono `HTTPException`, so middleware headers stay.
- **422 messages:** each issue becomes `{ path, message }` only, never the library's `input`, `received` or `keys`, on 0.5 request classes too. A default message that ends with the word `received` (in any case) and the submitted value (in any case; zod 3 `..., received 'x'`, valibot `... but received "x"` and `Invalid email: Received "x"`) loses that tail with the separators before it (`, `, `: `, ` but `); `received` inside a word (`unreceived`) is not that tail, and zod's unrecognized keys after the first `": "` are cut (`Unrecognized key(s) in object`). A cut that leaves nothing, empty or whitespace only (`Received "x"`, `: a`, `" : a"`), becomes `Invalid value`; a message no cut shortened is kept as the app wrote it, an empty one included. A zod `invalid_type` keeps its `received`, which is a type name. Any other message, the app's own included, is kept.
- **Only invalid input is a 422:** an error thrown inside a schema rejects and ends as the generic 500 ([http.md › Exceptions](./http.md#exceptions)).
- **Context:** the handler context is built from the validated **output** types (`InferOut`), so handlers see coerced and defaulted values.

### Diagnostics
Runtime, besides the 400 and 422 bodies above: a malformed body is that 400 for JSON and form alike, and so is a body read that fails (a client abort or a truncated stream, no error-level log); a body over a `bodyLimit` mounted with `app.use()` before the kernel keeps the middleware's **413** (the pipeline rethrows its `BodyLimitError` untouched); a body an earlier middleware read off `c.req.raw` directly, with nothing in Hono's cache, ends as the generic **500** (`{ message: "Server Error" }`, logged), never as a 400, while one it read through `c.req.parseBody()`, `validator('form')`, `c.req.arrayBuffer()`, `c.req.blob()` or `c.req.text()` is served from that cache, a 200 — except a multipart body read with `c.req.text()`, whose file parts cannot be rebuilt, which is the **500**, logged with `a middleware read the multipart body with c.req.text(), so its file parts cannot be rebuilt`. `RequestKernel.handle` throws a `TypeError` when a contract route also gets a request class, ``<route name or path>: a contract route validates its endpoint's query and body schemas, so it takes no request class (<Request>)``. The route proof reports a handler whose `query` or `body` type doesn't match the schema output as a TypeScript error whose property name is ``<c>.<e>: `query` of the ctx does not match the handler (it is the output of the endpoint's query schema) ``, and the same with `body`, with the detail `{ route_provides, handler_requires }` ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract)).

### Example
Runtime tests: [`packages/http/__tests__/request/pipeline.test.ts`](../../packages/http/__tests__/request/pipeline.test.ts) and [`packages/http/__tests__/request/cachedBody.test.ts`](../../packages/http/__tests__/request/cachedBody.test.ts) (a body an earlier middleware read, and a read that fails).

### Non-goals
- No coercion by the framework: a query value stays a string until the schema converts it.
- No prefix in the error bag for the query or the body.
- The ctx has no headers or request helpers: a handler that needs them reads the 0.5 request with `ContextApi.getRequest()` (`@laratype/support`) until typed middleware (H6 [#117](https://github.com/Laratypes/Laratype/issues/117)) provides them. Changes 0.5 middleware makes to `input()` don't reach the ctx, which is built from the parsed request.

### Open questions
- None recorded.

### Acceptance
[#106 Done when](https://github.com/Laratypes/Laratype/issues/106) · [#287 Done when](https://github.com/Laratypes/Laratype/issues/287)

---

## FormRequest v2

### Status
planned → [#137](https://github.com/Laratypes/Laratype/issues/137) (H10, M3).

### Design (non-binding)
- **Base class (#137):** `FormRequest<typeof users.store>`, with `messages()`. Message keys are inferred from the schema.
- **No `authorize()`:** a 403 only comes from the `authorize` capability and its policy ([http.md › Authorization from the contract](./http.md#authorization-from-the-contract)).
- **Async rules:** for example a unique email, run as async refinements.
- **i18n:** messages through `@laratype/i18n` ([#167](https://github.com/Laratypes/Laratype/issues/167)).
- **Rules:** the rules default to the contract's body schema. FormRequest only **adds** messages and async rules, and never redefines the schema.
- **Pipeline position:** it runs with validation, after the policies (see [http.md › Request pipeline](./http.md#request-pipeline)).

### Acceptance
[#137 Done when](https://github.com/Laratypes/Laratype/issues/137)
