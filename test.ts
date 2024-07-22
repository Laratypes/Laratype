import { parseFromFiles } from '@ts-ast-parser/core';
import fs from "fs"

void async function() {
  const {project, errors} = await parseFromFiles(['src/controllers/UserController.ts'], {});
  
  if (errors.length > 0) {
      // Handle the errors
      process.exit(1);
  }
  
  const reflectedModules = project?.serialize() ?? [];
  fs.writeFileSync('controller-reflected.json', JSON.stringify(reflectedModules, null, 2));
  console.log(reflectedModules);
}()