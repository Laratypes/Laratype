export class User {
  constructor(
    public id: number,
    public name: string,
    public email: string,
    public role: "admin" | "member" = "member",
  ) {}

  static async find(id: string): Promise<User | undefined> {
    return id === "1" ? new User(1, "Ada", "ada@example.com", "admin") : undefined;
  }
}
