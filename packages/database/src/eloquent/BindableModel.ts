/**
 * The static side of a model class `r.bind({ user: User })` takes (docs/v1/database.md › BindableModel): the lookup is
 * `User.findByRouteKey(key)`, `routeKeyName` defaults to `primaryKey`, and a `null` / `undefined` miss answers the
 * route's 404 (H7 #118). Type-only and structural, so `@laratype/http` types its binders against the same shape
 * without importing this package, and any class with these three statics fits without an `implements` clause.
 */
export interface BindableModel<M extends object = object> {
  new (...args: any[]): M;
  /** The property `routeKeyName` defaults to. */
  readonly primaryKey: string;
  /** The property a route param looks the model up by. */
  readonly routeKeyName?: string;
  findByRouteKey(key: string): Promise<M | null | undefined>;
}
