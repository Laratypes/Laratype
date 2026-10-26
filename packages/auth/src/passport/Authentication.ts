import { Hash } from "@laratype/support"
import { type Model } from "@laratype/database"

const ALIAS = "user"

/** Checked when no user matches, so an unknown user takes as long as a wrong password. */
let unknownUserHash: string | undefined

export default class Authentication {

  /**
   * The user that `fields` names, or `null`. The user is looked up by every field but the guard's `passwordField`
   * (`password` by default), and the password is then checked with `Hash.check()`, since a salted hash can't be matched
   * in the query. A hash from an older format (0.5's sha256) is replaced on a successful login.
   */
  public static async login<T extends Model = any>(guard: any, fields: Record<string, any>): Promise<T | null> {
    const model: typeof Model = guard.provider
    const passwordField: string = guard.options?.passwordField ?? "password"
    const { [passwordField]: password, ...where } = fields
    // An empty or undefined lookup field would match any user
    const values = Object.values(where)
    if (typeof password !== "string" || values.length === 0 || values.some((value) => value === undefined || value === null)) {
      return null
    }

    const column = model.getRepository().metadata.findColumnWithPropertyName(passwordField)
    if (!column) throw new Error(`[@laratype/auth] ${model.name} has no "${passwordField}" column (the guard's passwordField)`)
    // addSelect: the password column is usually { select: false }
    const user: any = await model.createQueryBuilder(ALIAS).where(where).addSelect(`${ALIAS}.${column.propertyPath}`).getOne()
    if (!user) {
      Hash.check(password, unknownUserHash ??= Hash.make(""))
      return null
    }

    const hashed = user[passwordField]
    // The returned user has the shape a plain lookup gives: no hidden password column
    if (!column.isSelect) delete user[passwordField]
    if (!Hash.check(password, hashed)) return null
    if (Hash.needsRehash(hashed)) {
      const rehashed = Hash.make(password)
      await model.getRepository().update(model.getId(user), { [passwordField]: rehashed })
      if (column.isSelect) user[passwordField] = rehashed
    }
    return user
  }
}
