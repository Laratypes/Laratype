import { StatusCode } from "hono/utils/http-status";
import Exceptions from "./Exceptions";

export class ValidationException extends Exceptions {
  protected code = "VALIDATION"
  protected responsible = true;
  protected httpCode: StatusCode = 422;
}