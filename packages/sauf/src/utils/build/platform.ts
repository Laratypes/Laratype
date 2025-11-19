import { resolveSync } from "@laratype/support"

export const getPlatformAdapter = (platform: string) => {
  if(platform === 'node') {
    try {
      return resolveSync("@hono/node-server")
    }
    catch (error) {
      throw new Error("Please install '@hono/node-server' to build the application for Node.js platform. You can install it via 'npm install @hono/node-server' or 'yarn add @hono/node-server'.");
    }
  }

  throw new Error(`Platform adapter for '${platform}' is not supported yet.`)
}