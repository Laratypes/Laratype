import figlet from "figlet"
import { green } from "kolorist"
//@ts-ignore
import standard from "figlet/importable-fonts/Standard.js";

figlet.parseFont("Standard", standard);

console.log(green(figlet.textSync("Laratype")));