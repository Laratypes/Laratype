// @ts-check
import { existsSync, readFileSync, writeFileSync } from "fs";
import { entries } from "./alias.js";
import path from "path";
import { program } from "commander"

program.argument("<version>", "Version want to increment")
.action((version) => {
  Object.entries(entries)
    .map(([pkgName, entryPoint]) => {
      return path.resolve(entryPoint, "../../package.json")
    })
    .filter((entryPoint) => existsSync(entryPoint))
    .forEach((entryPoint) => {
      const packageContent = JSON.parse(readFileSync(entryPoint).toString());
      const oldVersion = packageContent.version
      const packageName = packageContent.name;
      packageContent.version = version;

      writeFileSync(entryPoint, JSON.stringify(packageContent, null, 2) + "\n")

      console.log(`${packageName}: ${oldVersion} -> ${version} increment version successfully`);
    
    });
  
})

program.parse()

  