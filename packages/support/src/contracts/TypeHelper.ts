
export type PromiseAble<T> = T | Promise<T>;

export type ExcludeFirstParameter<T extends (...args: any) => any> =
  T extends (first: any, ...rest: infer R) => any ? R : never;
