import * as di from 'virtual:laratype/di';
import { Container, Inject, assertEqual } from 'virtual:laratype/di';

const NAME = 'app.name';
const TOKENS = { clock: Symbol('Clock') } as const;
// A wrapper listed in `injectNames` (di.options.json): the transform reads its token argument.
const Use = (token: symbol | string) => Inject(token);

interface Clock {
  now(): number;
}

export class Svc {
  constructor(
    @di.Inject(TOKENS.clock) public clock: Clock,
    @Use(NAME) public name: string,
    @Inject('missing') public optional?: Clock,
  ) {}
}

const c = new Container().bind(TOKENS.clock, { now: () => 1 }).bind(NAME, 'laratype').bind('missing', undefined);
const s = c.resolve<Svc>(Svc);
assertEqual(s.clock.now(), 1, 'member-access @di.Inject');
assertEqual(s.name, 'laratype', 'configured injectNames wrapper');
assertEqual(s.optional, undefined, 'optional @Inject param');
