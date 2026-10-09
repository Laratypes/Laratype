// Server-side file (negative control for the FE fixture test). The FE must never reach this module.
import type { IncomingMessage } from 'node:http'
import { appApi } from '../app/contracts'

export const routes = { api: appApi, handle: (_req: IncomingMessage) => undefined }
export type AppRouter = typeof routes
