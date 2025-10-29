import MakeCommand from "../../utils/MakeCommand";

export default class MakeMiddlewareCommand extends MakeCommand {

  static signature = "make:middleware";

  static description = "Create a new middleware files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the middleware to create"
    }
  ]

  async make(middlewareNames: string[]) {
    const resourcePath = this.resolve("sauf", "Middleware.template");

    return middlewareNames.map(middlewareName => {
      const destinationPath = "./src/http/middleware/" + middlewareName + ".ts";
      const result = this.build(resourcePath, { MiddlewareName: this.getFileName(middlewareName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
