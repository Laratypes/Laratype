import MakeCommand from "../../utils/MakeCommand";

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

    return resourceNames.map(_resourceName => {
      const resourceName = _resourceName.endsWith("Resource") ? _resourceName : _resourceName + "Resource";
      const destinationPath = "./app/http/resources/" + resourceName + ".ts";
      const result = this.build(resourcePath, { ResourceName: this.getFileName(resourceName) });
      this.publish(result, destinationPath);

      if(options.collection) {
        const collectionPath = this.resolve("sauf", "ResourceCollection.template");
        const collectionName = resourceName + "Collection";
        const collectionDestinationPath = "./app/http/resources/" + collectionName + ".ts";
        const collectionFunction = collectionName.charAt(0).toLowerCase() + collectionName.slice(1);
        const collectionResult = this.build(collectionPath, {
          CollectionFunction: collectionFunction,
          ResourceName: this.getFileName(resourceName)
        });
        this.publish(collectionResult, collectionDestinationPath);
      }

      return destinationPath;
    });
  }
}
