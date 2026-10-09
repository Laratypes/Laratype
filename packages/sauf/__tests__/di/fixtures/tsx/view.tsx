import { Clock } from './main.js';

export const h = (tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ tag, props, children });

const Badge = <T,>(props: { value: T }) => <b>{String(props.value)}</b>;

export class Page {
  constructor(public clock: Clock) {}
  render() {
    return <Badge value={this.clock.now()} />;
  }
}
