import { Container, depsRegistry } from '@laratype/core';
import { GreetingService } from './greeting';

export class GreetingController {
  constructor(private greeting: GreetingService) {}

  show() {
    return this.greeting.greet('plugin');
  }
}

export const show = () => new Container({ deps: depsRegistry }).make(GreetingController).show();
