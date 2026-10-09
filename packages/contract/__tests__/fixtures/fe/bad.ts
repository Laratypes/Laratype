// Anti-pattern (negative control): taking the API type from the server routes file drags server code into the FE program.
import type { AppRouter } from '../server/routes'

export type Api = AppRouter['api']
