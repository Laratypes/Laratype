import { createRouter } from "../lib/router";
import { users } from "../../s2-api/app/contracts/users";
import { User } from "./models/User";
import { auth } from "./middleware/auth";
import { UserControllerA } from "./controllers/UserControllerA";
import { UserControllerB } from "./controllers/UserControllerB";

export const r = createRouter();

// model binding by class
r.middleware(auth()).bind({ user: User }).contract(users, UserControllerA);
// custom resolver (Promise<User | undefined>, 404 on miss)
r.middleware(auth()).bind({ user: User.find }).contract(users, UserControllerB);
