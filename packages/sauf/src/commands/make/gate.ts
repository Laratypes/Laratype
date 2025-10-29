import MakeCommand from "../../utils/MakeCommand";

export default class MakeGateCommand extends MakeCommand {

  static signature = "make:gate";

  static description = "Create a new gate files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the gate to create"
    }
  ]

  async make(gateNames: string[]) {
    const resourcePath = this.resolve("sauf", "Gate.template");

    return gateNames.map(gateName => {
      const destinationPath = "./src/gates/" + gateName + ".ts";
      const result = this.build(resourcePath, { GateName: this.getFileName(gateName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
