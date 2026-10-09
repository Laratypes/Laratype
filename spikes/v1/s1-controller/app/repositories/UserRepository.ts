import { User } from "../models/User";

export class UserRepository {
  private rows = [new User(1, "Ada", "ada@example.com", "admin"), new User(2, "Linus", "linus@example.com")];

  async list(page: number) {
    return this.rows.slice((page - 1) * 10, page * 10);
  }

  async create(input: { name: string; email: string }) {
    const u = new User(this.rows.length + 1, input.name, input.email);
    this.rows.push(u);
    return u;
  }
}
