import Exceptions from "./Exceptions";

export default class InternalException extends Exceptions {
  constructor(message = "Something went wrong!") {
    super({
      code: "INTERNAL_ERROR",
      message,
      responsible: true,
    })
  } 
}