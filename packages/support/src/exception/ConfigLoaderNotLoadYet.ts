import Exceptions from "./Exceptions";

export class ConfigLoaderNotLoadYet extends Exceptions {
  constructor() {
    super({
      code: "CONFIG_LOADER_ERROR",
      message: "Config loader not loaded correctly",
      responsible: true,
    })
  } 
}