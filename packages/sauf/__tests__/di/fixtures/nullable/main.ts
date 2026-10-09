import { Container, getDeps, assertEqual } from 'virtual:laratype/di';

class Clock {}

export class Report {
  constructor(public clock: Clock | undefined, public fallback: Clock | null, public label: string | undefined) {}
}

const entry = getDeps(Report)!.entry;
assertEqual(JSON.stringify(entry.meta.optional), '[0,1,2]', '`T | undefined` / `T | null` are optional');
const r = new Container().resolve<Report>(Report);
assertEqual(r.clock instanceof Clock && r.fallback instanceof Clock, true, 'nullable class types are still injected');
assertEqual(r.label, undefined, 'nullable primitive gets undefined instead of throwing');
