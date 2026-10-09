import { Container, assertEqual } from 'virtual:laratype/di';
import { Page } from './view.js';

export class Clock {
  now() {
    return 42;
  }
}

const page = new Container().resolve<Page>(Page);
const vnode = page.render() as any;
assertEqual(page.clock instanceof Clock, true, 'class in a .tsx file is injected');
assertEqual(vnode.props.value, 42, 'JSX still compiles');
