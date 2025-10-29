import { Command, Console } from "@laratype/console";
import { resolvePathSync } from "@laratype/support";
import { compile } from "handlebars";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export default class MakeCommand extends Command {

  public async providers() {
    return [];
  }

  resolve(pkgName: string, fileName: string) {
    return resolvePathSync(`${pkgName}/resources/templates/${fileName}`);
  }

  copyFile(source: string, destination: string): void {
    return cpSync(source, destination);
  }

  getFileName(dir: string): string {
    return path.basename(dir);
  }

  writeFile(destination: string, content: string): void {
    if(existsSync(destination)) {
      Console.warn(`[SKIPPED] The file ${destination} already exists.`);
      return;
    }
    const dir = destination.replace(/\/[^\/]+$/, "");
    if(!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return writeFileSync(destination, content);
  }

  build(source: string, data: any) {
    const file = readFileSync(source, "utf-8");
    const template = compile(file);
    return template(data);
  }

  publish(fileContent: string, destination: string): void {
    this.writeFile(destination, fileContent);
  }

  async make(...args: any): Promise<any> {
  }

  public async handle(...args: any[]): Promise<void> {
    const filePaths = await this.make(...args);
    if(!Array.isArray(filePaths)) {
      Console.success(`The file ${filePaths} has been created successfully.`);
      return;
    }
    Console.success(`The files [${filePaths.join(", ")}] have been created successfully.`);
  }

}
