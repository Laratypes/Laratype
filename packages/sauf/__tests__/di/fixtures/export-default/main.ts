import { Container, assertEqual } from 'virtual:laratype/di';
import Named from './named.js';
import Anon from './anon.js';
import Collide, { __laratype_default as UserOwn } from './collide.js';
import { Dep } from './dep.js';

const c = new Container();
assertEqual(c.resolve<Named>(Named).dep instanceof Dep, true, 'export default class Named');
assertEqual(c.resolve<InstanceType<typeof Anon>>(Anon).dep instanceof Dep, true, 'anonymous export default class');
// Without the transform the name would be "default"; the inserted binding renames it.
assertEqual(Anon.name, '__laratype_default', 'anonymous default class gets a generated name');
assertEqual(c.resolve<InstanceType<typeof Collide>>(Collide).dep instanceof Dep, true, 'anonymous default class next to a user __laratype_default');
assertEqual(Collide.name, '__laratype_default_1', 'generated name is aliased when taken');
assertEqual(new UserOwn().user, true, 'user __laratype_default untouched');
