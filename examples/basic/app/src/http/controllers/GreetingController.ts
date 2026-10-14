import { Controller } from "@laratype/http";
import GreetingService from "../../services/GreetingService";

// Constructor DI without a decorator: `laratype:di` records `GreetingService` as this class's dependency.
export default class GreetingController extends Controller {

  constructor(private greeting: GreetingService) {
    super()
  }

  public show() {
    return {
      message: this.greeting.greet("Laratype"),
    }
  }
}
