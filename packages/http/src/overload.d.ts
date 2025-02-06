import { HonoRequest } from "hono/request";

export {}

declare module 'hono/request' {
  interface HonoRequest {
    input: Record<string, any>
  }
}