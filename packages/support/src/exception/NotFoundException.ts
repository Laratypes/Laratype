import { Exception } from "./Exception";

export class NotFoundException extends Exception {
  constructor(message = "Resource not found!") {
    super({
      code: "NOT_FOUND",
      httpCode: 404,
      message,
      responsible: true,
      reportable: false,
    })
  } 
}
