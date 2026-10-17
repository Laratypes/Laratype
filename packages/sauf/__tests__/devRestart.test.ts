import { describe, expect, it } from 'vitest';
import { DevRestarter, shouldRestart } from '../src/utils/restarter';
import type { ApiPluginApi } from '../src/typegen';

// `sauf dev --hmr` restarts (H1 #104 review)
const instance = (name: string, log: string[], failDown = false) => ({
  name,
  down: async () => {
    log.push(`down ${name}`);
    if (failDown) throw new Error(`down ${name} failed`);
  },
});

describe('DevRestarter', () => {
  it('runs restarts one after another', async () => {
    const log: string[] = [];
    let n = 0;
    const restarter = new DevRestarter(async () => {
      const i = ++n;
      log.push(`start ${i}`);
      await new Promise((r) => setTimeout(r, 5));
      return instance(String(i), log);
    }, (e) => log.push(`error ${String(e)}`));
    restarter.instance = instance('0', log);
    void restarter.restart();
    await restarter.restart();
    expect(log).toEqual(['down 0', 'start 1', 'down 1', 'start 2']);
    expect(restarter.instance?.name).toBe('2');
  });

  it('coalesces a burst of events into at most one more restart', async () => {
    let starts = 0;
    let release!: () => void;
    const restarter = new DevRestarter(async () => {
      starts++;
      if (starts === 1) await new Promise<void>((r) => (release = r));
      return instance(String(starts), []);
    }, () => {});
    const first = restarter.restart();
    for (let i = 0; i < 10; i++) void restarter.restart();
    await new Promise((r) => setTimeout(r, 5));
    release();
    await first;
    expect(starts).toBe(2);
    // a quiet restarter starts again on the next event
    await restarter.restart();
    expect(starts).toBe(3);
  });

  it('a failed start leaves no instance, so the next restart does not call down() twice', async () => {
    const log: string[] = [];
    let fail = true;
    const errors: unknown[] = [];
    const restarter = new DevRestarter(async () => {
      if (fail) throw new Error('boot failed');
      return instance('ok', log);
    }, (e) => errors.push(e));
    restarter.instance = instance('first', log);
    await restarter.restart();
    expect(restarter.instance).toBeUndefined();
    expect(errors.map(String)).toEqual(['Error: boot failed']);
    fail = false;
    await restarter.restart();
    expect(log).toEqual(['down first']);
    expect(restarter.instance?.name).toBe('ok');
  });

  it('a throwing down() is reported and the restart still starts a new instance', async () => {
    const log: string[] = [];
    const errors: unknown[] = [];
    const restarter = new DevRestarter(async () => instance('new', log), (e) => errors.push(e));
    restarter.instance = instance('old', log, true);
    await restarter.restart();
    expect(errors.map(String)).toEqual(['Error: down old failed']);
    expect(restarter.instance?.name).toBe('new');
    await restarter.restart();
    expect(log).toEqual(['down old', 'down new']);
  });
});

describe('shouldRestart', () => {
  const tree = {
    inTree: (file: string) => file.startsWith('/p/app/api/'),
    isGenerated: (file: string) => file.startsWith('/p/.laratype/'),
  } as ApiPluginApi;

  it('restarts on a change, but not on the scan output', () => {
    expect(shouldRestart('change', '/p/app/src/x.ts', tree)).toBe(true);
    expect(shouldRestart('change', '/p/.laratype/api/index.gen.ts', tree)).toBe(false);
  });

  it('restarts when a file is added to or deleted from the contract tree', () => {
    expect(shouldRestart('add', '/p/app/api/things.ts', tree)).toBe(true);
    expect(shouldRestart('unlink', '/p/app/api/users/[user]/_scope.ts', tree)).toBe(true);
    expect(shouldRestart('add', '/p/app/src/new.ts', tree)).toBe(false);
    expect(shouldRestart('add', '/p/.laratype/types/x/$types.d.ts', tree)).toBe(false);
  });

  it('without the plugin, only changes restart', () => {
    expect(shouldRestart('change', '/p/x.ts', undefined)).toBe(true);
    expect(shouldRestart('add', '/p/app/api/x.ts', undefined)).toBe(false);
  });
});
