import { CompilerOptions, createProgram, ModuleKind, transpileDeclaration, transpileModule } from "typescript"
import { readFileSync } from "fs"
const targetFileUrl = "/workspaces/Laratype/core/ts-gen/src/controller/test.ts"

const targetFileContent = readFileSync(targetFileUrl, "utf-8")

// class GenerateController {

// }

const compilerOptions: CompilerOptions = {
  declaration: true,
  emitDeclarationOnly: true,
  importHelpers: true,
  module: ModuleKind.CommonJS,
  isolatedDeclarations: true,
}

const program = createProgram([targetFileUrl], compilerOptions)
const test = program.getSourceFiles()

const emitResult = program.emit(
  undefined,
  (fileName: string, data: string) => {
    console.log(fileName);
  },
  undefined,
  true
);

const output = transpileDeclaration(targetFileContent, {
  compilerOptions,
})

console.log(test);
