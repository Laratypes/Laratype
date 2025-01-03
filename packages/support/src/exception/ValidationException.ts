import Exceptions from "./Exceptions";

export class ValidationException extends Exceptions {
  protected code = "VALIDATION"
  protected responsible = true;
}