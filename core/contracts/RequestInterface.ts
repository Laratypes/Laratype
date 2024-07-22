
export default interface RequestInterface {
  
  /**
   * Define rule of request's
   */
  rules(): Record<string, any>

  /**
   * Get all input data validated
   */
  validate (): Record<string, any>

  /**
   * Get input data expected
   * @param key 
   * Return all of the key / value
   */
  only(key: string[]): Record<string, any>

  params(): Record<string, string>

  param(key: string): string

  except(key: string[]): Record<string, any>

  all(): Record<string, any>

  query(): Record<string, any>

  has(key: string, defaultVal: string): boolean

  has(keys: string[]): boolean

  hasAny(keys: string[]): boolean

  query(key: string): Record<string, any>

  query(key: string, defaultVal: string): Record<string, any>

  path(): string

  url(): string

  isMethod(method: string): boolean

  header(key: string): string

  header(key: string, defaultVal: string): string

  hasHeader(hasHeader: string): boolean

  bearerToken(): string

  ip(): string
}