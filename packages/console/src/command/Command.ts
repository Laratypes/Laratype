import { AppServiceProvider, ServiceProvider } from '@laratype/support';

export type ArgumentType = {
  name: string;
  description?: string;
};

class Command {
  static signature: string;

  static description: string;

  static options: string[][] | undefined;

  static arguments: ArgumentType[] | undefined;

  public opts(): any {

  }

  public async boot(...args: any[]) {
    // Implement boot logic here
  }

  public handle(...args: any[]) {
    // Implement your command logic here
  }

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    // Implement filtering logic here
    return providers;
  }
}

export default Command;