// camelize('PersonalAccessToken') is `personalAccessToken`: the key of the generated Register['models'] entry.
export default class PersonalAccessToken {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<PersonalAccessToken | null> {
    return key === '' ? null : new PersonalAccessToken()
  }

  declare readonly id: number
}
