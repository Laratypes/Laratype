import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import greetingContract from "../../api/greeting";
import GreetingService from "../../services/GreetingService";

// Constructor DI without a decorator: `laratype:di` records `GreetingService` as this class's dependency.
export default class GreetingController extends Controller {

  constructor(private readonly greeting: GreetingService) {
    super();
  }

  public show(_ctx: Ctx<typeof greetingContract.show>) {
    return {
      message: this.greeting.greet("Laratype"),
    };
  }
}
