import type { RedirectStatusCode, StatusCode } from "@laratype/support";

export default interface ResponseInterface {
  setHttpStatus(httpStatusCode: StatusCode): this;

  setHeader(key: string, value: string): this;

  setHeaders(headers: Record<string, string>): this;

  redirect(url: string, httpStatusCode: RedirectStatusCode): this;

  setContent(content: any): this;
  
  setContentType(contentType: string): this;
  
  shouldBeJson(): boolean;
}