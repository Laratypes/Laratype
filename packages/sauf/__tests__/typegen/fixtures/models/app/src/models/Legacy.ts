// The 0.5 layout is read too (`app/src/models`), with the same key rule.
export default class Legacy {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<Legacy | null> {
    return key === '' ? null : new Legacy()
  }

  declare readonly id: number
}
