import { PublishCommand } from "@laratype/auth"
import { command } from "@laratype/console"

export default [
  // 0.5: auth:publish still writes app/src/models/PersonalAccessToken.ts; #419 moves it with the 0.5 paths.
  PublishCommand,
  command("hello:user {user} {--shout}", ({ user, shout }) => {
    const message = `Hello ${user}`
    console.log(shout ? message.toUpperCase() : message)
  }),
]
