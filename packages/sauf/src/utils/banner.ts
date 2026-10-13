import figlet from "figlet"
import { green } from "kolorist"
//@ts-ignore
import standard from "figlet/importable-fonts/Standard.js";

// The font file is ESM in a package without "type": "module". Bun >= 1.4 compiles the
// default import in the CJS dist as Node interop on require(), which yields the module
// namespace (require(esm)) instead of the font string.
const font: string = typeof standard === "string" ? standard : standard.default;

figlet.parseFont("Standard", font);

console.log(green(figlet.textSync("Laratype")));