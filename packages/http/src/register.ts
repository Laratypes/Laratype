/**
 * The app's registrations, filled by module augmentation (docs/v1/http.md › Route names and URLs and › Model
 * binding):
 *
 * @example
 * declare module '@laratype/http' {
 *   interface Register {
 *     routes: typeof apiRoutes
 *     models: { user: typeof User; post: typeof Post }
 *   }
 * }
 */
export interface Register {}

/**
 * @internal The models the app registered: keyed by path param, valued by the model class. `.laratype/types/models.d.ts`
 * writes the augmentation; the proof maps a registered key to the class's instance (docs/v1/http.md › Model binding).
 * Not exported by the package index: an implementation detail of the proof.
 */
export type RegisteredModels<R = Register> = R extends { readonly models: infer M extends object } ? M : {};
