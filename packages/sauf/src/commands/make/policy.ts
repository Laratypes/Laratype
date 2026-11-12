import { camelize } from "@laratype/support";
import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

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
    const name = generatorPath(policyName, "policy", { identifier: true });

    const destinationPath = `./${GENERATOR_FOLDERS.policy}/${name}.ts`;
    const data: {
      PolicyName: string;
      ModelName?: string;
      ParamName?: string;
    } = {
      PolicyName: this.getFileName(name),
    }

    if(options.m) {
      // The model generator's rules: `-m my-note` would be an import binding and a type, and `-m ../x` would be
      // flattened silently by `getFileName()`. The last segment names the model, as before.
      const modelName = this.getFileName(generatorPath(options.m, "model", { identifier: true }));
      data.ModelName = modelName;
      data.ParamName = camelize(modelName);
    }
    const result = this.build(resourcePath, data);

    this.publish(result, destinationPath);
    return destinationPath;
  }
}
