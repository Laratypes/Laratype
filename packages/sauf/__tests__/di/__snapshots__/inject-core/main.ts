import { __laratype_deps } from "virtual:laratype/di";
import { Container, DiError, Inject, Inject as Use, Injectable, depsRegistry } from '@laratype/core';
import type { Mailer } from './tokens.js';
import { APP_NAME, MAILER } from './tokens.js';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(`Assertion failed: ${message}`);
};

class Clock {}

@Injectable({ scope: 'singleton' })
export class Notifier {
  constructor(
    @Inject(MAILER) private mailer: Mailer,
    @Use(APP_NAME) public appName: string,
    public clock: Clock,
  ) {}
  notify() {
    return this.mailer.send(this.appName);
  }
}
__laratype_deps(Notifier, [() => MAILER, () => APP_NAME, () => Clock], { params: ["mailer","appName","clock"] });

@Injectable()
export class Job {
  constructor(public notifier: Notifier) {}
}
__laratype_deps(Job, [() => Notifier], { params: ["notifier"] });

// Wrapper decorators are invisible to the build transform: the runtime @Inject record supplies the token.
const InjectMailer = () => Inject(MAILER);

export class Digest {
  constructor(@InjectMailer() public mailer: Mailer) {}
}
__laratype_deps(Digest, [{ unresolved: "Mailer", index: 0 }], { params: ["mailer"] });

class ConsoleMailer implements Mailer {
  send(to: string) {
    return to;
  }
}

export class Conflicting {
  constructor(@InjectMailer() public mailer: ConsoleMailer) {}
}
__laratype_deps(Conflicting, [() => ConsoleMailer], { params: ["mailer"] });

const mailer: Mailer = { send: (to) => `sent:${to}` };
const c = new Container({ deps: depsRegistry }).instance(MAILER, mailer).instance(APP_NAME, 'laratype');

const notifier = c.make(Notifier);
check(notifier.notify() === 'sent:laratype', '@Inject token for an interface + aliased @Inject for a primitive');
check(notifier.clock instanceof Clock, 'param after @Inject params keeps its index');

check(c.make(Notifier) === notifier, '@Injectable({ scope: singleton }) autowires once');
check(c.createChild().make(Notifier) === notifier, 'children share the root singleton');
check(c.make(Job) !== c.make(Job), '@Injectable() without a scope stays transient');
check(c.make(Job).notifier === notifier, 'transient class gets the singleton dependency');

check(c.make(Digest).mailer === mailer, 'unresolved slot + runtime @Inject record -> token used');
try {
  c.make(Conflicting);
  check(false, 'transform thunk vs wrapper decorator disagreement throws');
} catch (e) {
  check(e instanceof DiError, `conflict is a DiError: ${String(e)}`);
  check(
    (e as Error).message
      === 'Conflicting metadata for Conflicting constructor param #0 `mailer`: transform says ConsoleMailer, @Inject says InjectionToken(Mailer).',
    `conflict message: ${(e as Error).message}`,
  );
}
