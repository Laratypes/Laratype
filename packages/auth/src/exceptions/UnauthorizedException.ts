import { UnauthorizedException as BaseUnauthorizedException } from "@laratype/support";

/** The auth 401: the shared exception of `@laratype/support`, as this package's default export. */
export default class UnauthorizedException extends BaseUnauthorizedException {}
