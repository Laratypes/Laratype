import { fileURLToPath } from "url";

const esmConfigure = {
  entrypoints: [fileURLToPath(import.meta.resolve("./src/cli.ts"))],
  outdir: fileURLToPath(import.meta.resolve("./resources/app")),
  target: "node",
  format: "esm",
  splitting: false,
  minify: true,
  naming: "[dir]/[name].[ext]",
  define: {
    "globalThis.__PROD__": "true",
    "globalThis.__APP_PROD__": "true",
  },
  external: [
    /@laratype\/.*/,
  ]
}

const esmConfigureCli = {
  ...esmConfigure,
}

const makeConfigureAdapter = (adapterName) => {
  return {
    ...esmConfigure,
    entrypoints: [fileURLToPath(import.meta.resolve(`./src/adapters/${adapterName}/index.ts`))],
    outdir: fileURLToPath(import.meta.resolve(`./resources/app/adapters/${adapterName}`)),
    define: {
      ...esmConfigure.define,
      "__APP_PLATFORM__": `"${adapterName}"`,
    }
  }
}

const configs = [
  esmConfigureCli,
  makeConfigureAdapter("node"),
];

export default configs;
