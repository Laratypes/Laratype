import { command } from "@laratype/console";
import { PublishCommand } from "@laratype/auth";

export default [
  PublishCommand,
  command("hello:user {user} {--shout}", ({ user, shout }) => {
    const message = `Hello ${user}`;
    console.log(shout ? message.toUpperCase() : message);
  }),
]
