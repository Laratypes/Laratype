import { resolveSync } from "@laratype/support"

export const getPlatformAdapter = (platform: string) => {
  if(platform === 'node') {
    try {
      return resolveSync('sauf/resources/app/adapters/node/index.js');
    }
    catch {
      throw new Error(`Node platform adapter not found. This caused by missing from Laratype Framework, please raise an issue on GitHub.`);
    }
  }

  throw new Error(`Platform adapter for '${platform}' is not supported yet.`)
}