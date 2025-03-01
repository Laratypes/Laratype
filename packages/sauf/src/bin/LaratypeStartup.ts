import { Command } from "@laratype/console";
import { Serve } from "laratype"

export default class LaratypeStartupCommand extends Command {
  static signature = 'start';

  static description = 'Start the Laratype application';

  public async handle() {
    console.log('Starting Laratype application...');
    const module = await Serve.create()
  }
}