import { fileURLToPath } from "url";

// figlet's Node entry sets its font path from `__dirname`, which Bun folds into the build machine's
// node_modules. The resources bundles are copied into an app's dist, where that path and figlet's fonts
// folder do not exist, so the banner resolves figlet through the browser entry with its font data
// (figlet-browser.mjs, next to this file, where sauf's declared figlet resolves it) instead. Package
// dists keep figlet external, as a declared dependency.
const figletBrowser = {
  name: "figlet-browser",
  setup(build) {
    build.onResolve({ filter: /^figlet$/ }, () => ({
      path: fileURLToPath(new URL("./figlet-browser.mjs", import.meta.url)),
    }))
  },
}

const esmConfigure = {
  entrypoints: [fileURLToPath(import.meta.resolve("./src/cli.ts"))],
  outdir: fileURLToPath(import.meta.resolve("./resources/app")),
  target: "node",
  format: "esm",
  splitting: false,
  minify: true,
  naming: "[dir]/[name].[ext]",
  plugins: [figletBrowser],
  define: {
    "globalThis.__PROD__": "true",
    "globalThis.__APP_PROD__": "true",
  },
  // Strings only: Bun ignores a RegExp external. The app that runs these bundles
  // (copied into its dist by `sauf build`) provides the @laratype packages.
  external: [
    "@laratype/*",
    "laratype",
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
