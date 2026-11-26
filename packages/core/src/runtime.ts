/** The dev check shared by the container and the facades: `__PROD__` first, then `NODE_ENV`. */
export const isProduction = (): boolean => {
  const g = globalThis as { __PROD__?: boolean, process?: { env?: Record<string, string | undefined> } }
  return g.__PROD__ ?? g.process?.env?.NODE_ENV === 'production'
}
