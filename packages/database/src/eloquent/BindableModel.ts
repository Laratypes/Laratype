/**
 * The static side of a model class `r.bind({ user: User })` takes (docs/v1/database.md › BindableModel): the lookup is
 * `User.findByRouteKey(key)`, `routeKeyName` defaults to `primaryKey`, and a `null` / `undefined` miss answers the
 * route's 404 (H7 #118). Type-only and structural, so `@laratype/http` types its binders against the same shape
 * without importing this package, and any class with these three statics fits without an `implements` clause.
 *
 * `scope` (H14 #163) holds the models bound for the route's earlier path params on a `r.scopeBindings()` route; declare
 * it as a plain second parameter (`(key, scope?)`), since `Function.length` is what the router checks.
 */
export interface BindableModel<M extends object = object> {
  new (...args: any[]): M;
  /** The property `routeKeyName` defaults to. */
  readonly primaryKey: string;
  /** The property a route param looks the model up by. */
  readonly routeKeyName?: string;
  findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<M | null | undefined>;
}
