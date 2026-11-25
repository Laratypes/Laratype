// A model with a custom lookup column and a scoped lookup: the second parameter is what `.scopeBindings()` passes.
export default class Post {
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static async findByRouteKey(key: string, _scope?: Readonly<Record<string, object>>): Promise<Post | null> {
    return key === '' ? null : new Post()
  }

  declare readonly id: number
  declare readonly slug: string
}
