// docs/v1/di.md: ServiceProvider v2 + two-phase boot. Proposed in PR #202 (D4); moves up one level on merge.
import { Container, token } from '@laratype/core'
import { bootProviders, ServiceProvider } from '@laratype/support'

export interface Clock { now(): Date }
export const CLOCK = token<Clock>('clock')

export class ClockServiceProvider extends ServiceProvider {
  // register(): bindings only. Every provider registers before any provider boots.
  register() {
    this.app.singleton(CLOCK, () => ({ now: () => new Date() }))
  }

  // boot(): every binding from every provider is available here.
  boot() {
    this.app.make(CLOCK).now()
  }
}

export async function main() {
  const app = new Container()
  // Instantiates each provider with the container, runs all register(), then all boot(), in order.
  const downs = await bootProviders(app, [ClockServiceProvider])
  // Cleanups come back in reverse boot order.
  for (const down of downs) await down()
}
