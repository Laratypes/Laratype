export { };

export type METHOD = "get" | "post" | "patch" | "put" | "delete"

export interface RequestInterface {
  
  /**
   * Define rule of request's
   */
  rules(): unknown

  /**
   * Get all input data validated
   */
  validated (): unknown

  /**
   * Get input data expected
   * @param key 
   * Return all of the key / value
   */
  only(key: string[]): Record<string, any>

  query(): Record<string, any>

  query(key: string): any

  query(key: string, defaultVal: any): any

  param(): Record<string, string>

  param(key: string): string

  input(): Record<string, any>

  input(key: string): any

  input(keys: string[]): any

  all(): Record<string, any>

  except(key: string[]): Record<string, any>

  has(keys: string[]): boolean

  has(key: string): boolean

  hasAny(keys: string[]): boolean

  path(): string

  url(): string

  isMethod(method: string): boolean

  header(key: string): string | undefined

  header(key: string, defaultVal: string): string | undefined

  hasHeader(hasHeader: string): boolean

  bearerToken(): string

  ip(): string

  method(): string
}