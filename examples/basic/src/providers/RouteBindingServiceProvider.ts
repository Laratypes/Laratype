import { Route } from "@laratype/http";
import { AppServiceProvider } from "@laratype/support";
import { User } from "../models/User";

export default class RouteBindingsServiceProvider extends AppServiceProvider {

  public boot(): void {
    Route.model("user", User)
    Route.bind("activeUser", async (value: string) => {
      const user = await User.findOne({ where: { id: Number(value), isActive: true } });
      return user;
    });
  }
}