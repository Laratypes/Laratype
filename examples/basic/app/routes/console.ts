import { PublishCommand } from "@laratype/auth"
import { command } from "@laratype/console"

export default [
  PublishCommand,
  command("hello:user {user} {--shout}", ({ user, shout }) => {
    const message = `Hello ${user}`
    console.log(shout ? message.toUpperCase() : message)
  }),
]
