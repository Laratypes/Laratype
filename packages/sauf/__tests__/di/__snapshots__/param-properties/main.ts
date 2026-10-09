import { __laratype_deps } from "virtual:laratype/di";
import { Container, assertEqual } from 'virtual:laratype/di';
import { UserRepo } from './repo.js';

class Logger {}

export class UserService {
  constructor(private readonly repo: UserRepo, public logger: Logger) {}
  get repoRef() {
    return this.repo;
  }
}
__laratype_deps(UserService, [() => UserRepo, () => Logger], { params: ["repo","logger"] });

class NoArgs {
  constructor() {}
}
__laratype_deps(NoArgs, [], { params: [] });

const c = new Container();
const svc = c.resolve<UserService>(UserService);
assertEqual(svc.repoRef instanceof UserRepo, true, 'private readonly param property injected');
assertEqual(svc.logger instanceof Logger, true, 'public param property injected (local class)');
assertEqual(c.resolve(NoArgs) instanceof NoArgs, true, 'explicit zero-arg constructor');
