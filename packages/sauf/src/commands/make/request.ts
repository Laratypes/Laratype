import MakeCommand from "../../utils/MakeCommand";

export default class MakeRequestCommand extends MakeCommand {

  static signature = "make:request";

  static description = "Create a new request files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the request to create"
    }
  ]

  async make(requestNames: string[]) {
    const resourcePath = this.resolve("sauf", "Request.template");

    return requestNames.map(requestName => {
      const destinationPath = "./src/http/requests/" + requestName + ".ts";
      const result = this.build(resourcePath, { RequestName: this.getFileName(requestName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
