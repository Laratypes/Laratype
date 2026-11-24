import { command } from "@laratype/console"

export default [
  command("hello:user {user} {--shout}", ({ user, shout }) => {
    const message = `Hello ${user}`
    console.log(shout ? message.toUpperCase() : message)
  }),
]
