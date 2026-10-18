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

/** Each boot runs the next step: returns an instance, or throws. */
const booting = (steps: Array<() => Promise<ReturnType<typeof instance>>>) => {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)]!();
};

describe('DevRestarter', () => {
  it('start() boots once and rethrows', async () => {
    const failing = new DevRestarter(async () => { throw new Error('broken app'); }, () => {});
    await expect(failing.start()).rejects.toThrow('broken app');
    expect(failing.current).toBeUndefined();
    const ok = new DevRestarter(async () => instance('0', []), () => {});
    await ok.start();
    expect(ok.current?.name).toBe('0');
  });

  it('runs restarts one after another', async () => {
    const log: string[] = [];
    let n = 0;
    const restarter = new DevRestarter(async () => {
      const i = n++;
      log.push(`start ${i}`);
      await new Promise((r) => setTimeout(r, 5));
      return instance(String(i), log);
    }, (e) => log.push(`error ${String(e)}`));
    await restarter.start();
    void restarter.restart();
    await restarter.restart();
    expect(log).toEqual(['start 0', 'down 0', 'start 1', 'down 1', 'start 2']);
    expect(restarter.current?.name).toBe('2');
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

  it('a failed restart leaves no instance, so the next restart does not call down() twice', async () => {
    const log: string[] = [];
    const errors: unknown[] = [];
    const restarter = new DevRestarter(booting([
      async () => instance('first', log),
      async () => { throw new Error('boot failed'); },
      async () => instance('ok', log),
    ]), (e) => errors.push(e));
    await restarter.start();
    await restarter.restart();
    expect(restarter.current).toBeUndefined();
    expect(errors.map(String)).toEqual(['Error: boot failed']);
    await restarter.restart();
    expect(log).toEqual(['down first']);
    expect(restarter.current?.name).toBe('ok');
  });

  it('a throwing down() is reported and the restart still starts a new instance', async () => {
    const log: string[] = [];
    const errors: unknown[] = [];
    const restarter = new DevRestarter(booting([
      async () => instance('old', log, true),
      async () => instance('new', log),
    ]), (e) => errors.push(e));
    await restarter.start();
    await restarter.restart();
    expect(errors.map(String)).toEqual(['Error: down old failed']);
    expect(restarter.current?.name).toBe('new');
    await restarter.restart();
    expect(log).toEqual(['down old', 'down new']);
  });
});

describe('shouldRestart', () => {
  const tree = {
    inTree: (file: string) => file.startsWith('/p/app/api/'),
    isGenerated: (file: string) => file.startsWith('/p/.laratype/'),
    affectsTree: (event: string, file: string) => file === '/p/app/config/config.ts' || (event !== 'change' && file.startsWith('/p/app/api/')),
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

  it('restarts when the config file is created or deleted', () => {
    expect(shouldRestart('add', '/p/app/config/config.ts', tree)).toBe(true);
    expect(shouldRestart('unlink', '/p/app/config/config.ts', tree)).toBe(true);
  });

  it('without the plugin, only changes restart', () => {
    expect(shouldRestart('change', '/p/x.ts', undefined)).toBe(true);
    expect(shouldRestart('add', '/p/app/api/x.ts', undefined)).toBe(false);
  });
});
