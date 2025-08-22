import { Command as Commander } from 'commander'

class Command {
  static signature: string;

  static description: string;

  protected commander: Commander;

  protected options: string[][] | undefined;

  protected argument: string | undefined;

  constructor() {
    const command = <typeof Command>this.constructor;

    const commander = this.commander = new Commander(command.signature);

    commander
      .description(command.description);

    this.options?.forEach(options => {
      const [flags, description, defaultValue] = options;
      commander.option(flags, description, defaultValue);
    });

    if (this.argument) {
      commander.argument(this.argument);
    }

    commander.action(this.handle.bind(this))
  }

  public getCommander() {
    return this.commander
  }

  public handle() {
    // Implement your command logic here
  }

}

export default Command;