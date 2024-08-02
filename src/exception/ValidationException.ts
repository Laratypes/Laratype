import Exceptions from "./Exceptions";

export default class ValidationException extends Exceptions {
  protected code = "VALIDATION"
  protected responsible = true;
}