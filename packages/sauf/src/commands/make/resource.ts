import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

export default class MakeResourceCommand extends MakeCommand {

  static signature = "make:resource";

  static description = "Create a new resource files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the resource to create"
    }
  ]

  static options = [
    ['-c, --collection', 'Create a resource collection class'],
  ];

  async make(resourceNames: string[]) {
    const options = this.opts();
    const resourcePath = this.resolve("sauf", "Resource.template");
    const names = resourceNames.map(resourceName => {
      const name = generatorPath(resourceName, "resource");
      // A sub-path (`admin/Post`) is a folder: the exported name is the file name alone
      const resource = name.endsWith("Resource") ? name : `${name}Resource`;
      return {
        resource,
        collection: options.collection ? generatorPath(`${resource}Collection`, "resource") : undefined,
      };
    });

    return names.map(({ resource, collection }) => {
      const destinationPath = `./${GENERATOR_FOLDERS.resource}/${resource}.ts`;
      const result = this.build(resourcePath, { ResourceName: this.getFileName(resource) });
      this.publish(result, destinationPath);

      if(collection) {
        const collectionPath = this.resolve("sauf", "ResourceCollection.template");
        const collectionFile = this.getFileName(collection);
        const collectionFunction = collectionFile.charAt(0).toLowerCase() + collectionFile.slice(1);
        const collectionResult = this.build(collectionPath, {
          CollectionFunction: collectionFunction,
          ResourceName: this.getFileName(resource)
        });
        this.publish(collectionResult, `./${GENERATOR_FOLDERS.resource}/${collection}.ts`);
      }

      return destinationPath;
    });
  }
}
