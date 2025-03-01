import { Command as Commander } from 'commander'

class Command {
  static signature: string;
  
  static description: string;

  protected commander: Commander;

  constructor() {
    const commander = this.commander = new Commander();

    const command = <typeof Command>this.constructor;

    commander
      .command(command.signature)
      .description(command.description)
  }

  public getCommander() {
    return this.commander
  }

  public handle() {
    // Implement your command logic here
  }

}

export default Command;