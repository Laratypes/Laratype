import { Injectable } from "@laratype/core";

export interface UserRecord {
  id: number;
  name: string;
  email: string;
}

export interface NewUserInput {
  name: string;
  email: string;
}

/**
 * The in-memory users of the E1 slice: a Map and an incrementing id, no database (persistence waits for S5 #88).
 * `@Injectable({ scope: 'singleton' })` keeps the store on the one instance the container builds per boot, so the users
 * survive between requests (autowired classes are transient by default) and a second boot starts empty.
 */
@Injectable({ scope: "singleton" })
export default class UserService {

  private readonly users = new Map<number, UserRecord>();

  private nextId = 1;

  public all(): UserRecord[] {
    return [...this.users.values()];
  }

  public find(id: number): UserRecord | undefined {
    return this.users.get(id);
  }

  public create(input: NewUserInput): UserRecord {
    const user = { id: this.nextId++, ...input };
    this.users.set(user.id, user);
    return user;
  }
}
