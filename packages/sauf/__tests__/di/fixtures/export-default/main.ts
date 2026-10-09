import { Container, assertEqual } from 'virtual:laratype/di';
import Named from './named.js';
import Anon from './anon.js';
import { Dep } from './dep.js';

const c = new Container();
assertEqual(c.resolve<Named>(Named).dep instanceof Dep, true, 'export default class Named');
assertEqual(c.resolve<InstanceType<typeof Anon>>(Anon).dep instanceof Dep, true, 'anonymous export default class');
// Without the transform the name would be "default"; the inserted binding renames it.
assertEqual(Anon.name, '__laratype_default', 'anonymous default class gets a generated name');
