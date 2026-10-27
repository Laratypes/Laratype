---
paths:
  - "packages/**/*.ts"
---

# Type declarations

## `interface` or `type`

- `interface` for a named object shape: options (`ContractOptions`, `BindOptions`), bodies and results (`MessageBody`, `ClientSuccess`), metadata (`DepsMeta`, `ApiRoute`), and any shape another type `extends`.
- `type` for everything else: unions (`ClientResult`), conditional and mapped types (`ErrorBody<E>`, `Client<T>`), function types (`EndpointCall`), template literal types (`Duration`, `FailureStatus`).
- A registry users fill with `declare module` is an empty exported interface (`GuardRegistry` in `packages/contract/src/capabilities.ts`). Biome warns `noEmptyInterface` on it; keep the interface.
- No `enum` and no `namespace` in v1 code. Use a string literal union, or an `as const` object when the values are needed at runtime. The `Enum` classes in `packages/support/src/enum` are 0.5 code.

## Fields

- Fields of options and of values the framework hands out are `readonly`, arrays included: `readonly throws?: readonly AnyErrorDef[]` (`ContractOptions`). Parameters that take arrays accept `readonly T[]`, so callers can pass `as const` arrays.
- In a union narrowed by a discriminant, members that lack a field the other members have declare it as `?: undefined`, so narrowing by `code` or `unexpected` works (`ClientSuccess.code?: undefined` in `packages/client/src/types.ts`).
- A type that only the type system uses is a phantom field: `declare readonly __type: T` (`InjectionToken` in `packages/core/src/token.ts`).

## Generics

- Public generic types have defaults, so the bare name means "any": `ErrorDef<St extends number = number, Code extends string = string, ...>`.
- When the defaults are not wide enough for a constraint, export an `Any*` alias: `AnyErrorDef`, `AnyContract`, `AnyEndpoint`, `AnyPrefix`, `AnyScope`.
- Use `const` type parameters where literals must be kept (`defineApi<const A extends ApiDef>`), and `NoInfer` where a position must not take part in inference.

## Exported functions and values

- Exported functions declare their parameter and return types: `joinPath = (prefix: string, path: string): string`. Declarations must not depend on inferred types.
- Type guards take `unknown` and return a predicate: `isContract = (value: unknown): value is AnyContract`.
- Brand symbols are typed `unique symbol`: `export const CONTRACT: unique symbol = Symbol.for("laratype.contract")`.
- Overloads list the public signatures first, then an implementation signature with wide types (`apiPaths` in `packages/contract/src/contract.ts`).

## Compile-time checks

- When a type must reject some inputs, intersect the parameter with a `Check*` type that maps a bad input to `{ error: "<function>: <message>" }`: `entries: A & CheckApi<A>`, `CheckEndpoints`, `CheckErrorBody`. The type error then shows the message.
- Use the same message text as the runtime check (`BodyProblem` and `checkBody` in `packages/contract/src/errors.ts`). The type check never replaces the runtime check: users can bypass types, and the runtime check may be stricter.

## Where types live

- A type lives in the file of the concept it describes. Public types of a whole package can get their own file (`packages/client/src/types.ts`, `packages/contract/src/api-types.ts`).
- Helper types used by one file stay unexported (`BodyProblem`, `Tree`, `Sub`). Helper types shared by several files go in `internal.ts` (`Digit`, `ToNumber`).
- Every exported type has a `/** */` JSDoc and a type test (`*.test-d.ts`).
