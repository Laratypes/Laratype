import { Command, Console } from "@laratype/console";
import { AppServiceProvider, resolvePathSync, ServiceProvider } from "@laratype/support";
import { cpSync } from "node:fs";

export class PublishCommand extends Command {

  static signature = "auth:publish";

  static description = "Publish the Laratype Auth resources";

  async handle() {
    const resource = resolvePathSync("@laratype/auth/resources/PersonalAccessToken.model");
    
    cpSync(resource, "./src/models/PersonalAccessToken.ts");

    Console.success("Published Laratype Auth resources successfully.");

    return 0;
  }
}