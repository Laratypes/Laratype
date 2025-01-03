import { ServiceProvider } from "../ServiceProvider";
import dayjs from "dayjs"
import timezone from "dayjs/plugin/timezone"
import utc from "dayjs/plugin/utc";
import { Config } from "../config";

dayjs.extend(utc)
dayjs.extend(timezone)

export default class DateTimeServiceProvider extends ServiceProvider {
  public boot(): void {
    const timezone = Config.get(['timezone'] as const)
    dayjs.tz.setDefault(timezone)
  }
}

