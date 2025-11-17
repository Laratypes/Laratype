import { Command } from "@laratype/console";

export default class SendMail extends Command {

  static signature = "send:mail";

  static description = "Send a test email";

  public async handle() {
    console.log("Sending a test email...");
  }

}