// Anti-pattern (what S2 replaces): the FE takes its API type from the server routes file.
// Even as `import type`, tsc must load routes -> controllers -> models/repositories -> router lib.
import type { r } from "../../../s1-controller/app/routes";
export type AppRouter = typeof r;
