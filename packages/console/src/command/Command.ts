import { Command as Commander } from 'commander'

class Command {
  static signature: string;

  static description: string;

  protected commander: Commander|undefined;

  static options: string[][] | undefined;

  static argument: string | undefined;

  constructor() {
    this.__initCommander();
  }

  protected __initCommander() {

    const command = <typeof Command>this.constructor;
    const commander = this.getCommander(); 

    commander
      .description(command.description);

    command.options?.forEach(options => {
      const [flags, description, defaultValue] = options;
      commander.option(flags, description, defaultValue);
    });

    if (command.argument) {
      commander.argument(command.argument);
    }

    commander.action(this.handle.bind(this))
  }

  public getCommander() {
    const command = <typeof Command>this.constructor;
    return this.commander ??= new Commander(command.signature);
  }

  public handle() {
    // Implement your command logic here
  }

}

export default Command;