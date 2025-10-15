import type { Context, Handler } from "@laratype/support"

export {}

export type safeMethods<T> = Exclude<keyof T, "exposed" | "__invoke">

export type ControllerMethod = (c: Context, req: Request) => ReturnType<Handler>

export interface IControllerMethod {
  exposed(): Array<safeMethods<this>>
}

export type ControllerParams = (c: Context, req: Request) => any