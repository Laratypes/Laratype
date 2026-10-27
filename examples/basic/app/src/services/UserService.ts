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
 * The store sits in the module, not on the instance: an autowired service is transient, so a per-request instance
 * would forget every user between two requests of the app.
 */
const users = new Map<number, UserRecord>();
let nextId = 1;

export default class UserService {

  public all(): UserRecord[] {
    return [...users.values()];
  }

  public find(id: number): UserRecord | undefined {
    return users.get(id);
  }

  public create(input: NewUserInput): UserRecord {
    const user = { id: nextId++, ...input };
    users.set(user.id, user);
    return user;
  }
}
