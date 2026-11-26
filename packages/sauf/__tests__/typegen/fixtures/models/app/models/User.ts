// A model file: its name is the path param (`user`), its default export is the class (H14 #163).
export default class User {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<User | null> {
    return key === '' ? null : new User()
  }

  declare readonly id: number
  declare readonly name: string
}
