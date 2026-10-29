import { Command } from "@laratype/console";
import GreetingService from "../../services/GreetingService";

export default class SendMail extends Command<typeof SendMail.signature> {

  static readonly signature = "send:mail {user} {--queue=}" as const;

  static description = "Send a test email";

  constructor(private readonly greeting: GreetingService) {
    super();
  }

  public async handle() {
    const queue = this.option("queue");
    console.log(`${this.greeting.greet(this.argument("user"))}${queue ? ` (queued on ${queue})` : ""}`);
  }

}
