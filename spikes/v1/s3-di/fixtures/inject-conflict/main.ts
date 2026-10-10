import { Container, Inject, assertEqual, assertThrows } from 'virtual:laratype/di';

interface ILogger {
  log(m: string): string;
}
class ConsoleLogger implements ILogger {
  log(m: string) {
    return m;
  }
}
const LOGGER = Symbol('Logger');
// Wrapper decorators are invisible to the build transform.
const InjectLogger = () => Inject(LOGGER);

export class UsesWrapperOnInterface {
  constructor(@InjectLogger() public logger: ILogger) {}
}

export class UsesWrapperOnClass {
  constructor(@InjectLogger() public logger: ConsoleLogger) {}
}

const c = new Container().bind(LOGGER, { log: (m: string) => `bound:${m}` });
assertEqual(
  c.resolve<UsesWrapperOnInterface>(UsesWrapperOnInterface).logger.log('x'),
  'bound:x',
  'unresolved marker + runtime @Inject record -> token used',
);
assertThrows(
  () => c.resolve(UsesWrapperOnClass),
  /Conflicting metadata for UsesWrapperOnClass constructor param #0 `logger`: transform says ConsoleLogger, @Inject says Symbol\(Logger\)/,
  'transform thunk vs wrapper decorator disagreement is detected',
);
