import { camelize } from "@laratype/support";
import MakeCommand from "../../utils/MakeCommand";

export default class MakePolicyCommand extends MakeCommand {

  static signature = "make:policy";

  static description = "Create a new policy file";

  static arguments = [
    {
      name: "<name>",
      description: "The name of the policy to create"
    }
  ]

  static options = [
    ['-m, --m <model>', 'The model to attach the policy to'],
  ];

  async make(policyName: string) {
    const options = this.opts();
    const resourcePath = this.resolve("sauf", "Policy.template");

    const destinationPath = "./src/policies/" + policyName + ".ts";
    const data: {
      PolicyName: string;
      ModelName?: string;
      ParamName?: string;
    } = {
      PolicyName: this.getFileName(policyName),
    }

    if(options.m) {
      data.ModelName = this.getFileName(options.m);
      data.ParamName = camelize(this.getFileName(options.m));
    }
    const result = this.build(resourcePath, data);

    this.publish(result, destinationPath);
    return destinationPath;
  }
}
