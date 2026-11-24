import { describe, expect, it } from 'vitest';
import { resolve, sep } from 'node:path';
import { inside, outputLinkDiagnostic, outputPathDiagnostic } from '../../src/typegen/sync';

/**
 * The output-path diagnostics (G2 #142): a POSIX folder name can carry a control character or an ANSI escape, while
 * Windows refuses such a name, so the message builders are tested with one directly. Both quote every path they echo
 * with `JSON.stringify`, like the rest of `ScanError`.
 */
describe('output path diagnostics', () => {
  it('quotes the relative and real paths, so a control character or ANSI escape never reaches the terminal raw', () => {
    const message = outputPathDiagnostic('types/bad\u0001file/$types.d.ts', 'C:\\project\u001b[31m/types');
    expect(message).toContain('the output path "types/bad\\u0001file/$types.d.ts" resolves outside the project');
    expect(message).toContain('("C:\\\\project\\u001b[31m/types")');
    expect(message).not.toContain('\u0001');
    expect(message).not.toContain('\u001b');
  });

  it('omits the real path of a broken link', () => {
    expect(outputPathDiagnostic('types/$types.d.ts')).toBe(
      'the output path "types/$types.d.ts" resolves outside the project: a junction or symlink under the output folder must stay inside it',
    );
  });

  it('quotes the path of a generated file that is a link', () => {
    const message = outputLinkDiagnostic('types/bad\u0001file/$types.d.ts');
    expect(message).toBe(
      'the output path "types/bad\\u0001file/$types.d.ts" is a symbolic link or junction; refusing to write through it',
    );
    expect(message).not.toContain('\u0001');
  });
});

describe('inside', () => {
  const project = resolve('project');

  it('allows a name that only starts with two dots, and rejects a parent segment', () => {
    expect(inside(project, resolve(project, 'openapi.json'))).toBe(true);
    expect(inside(project, resolve(project, '..openapi.json'))).toBe(true);
    expect(inside(project, resolve(project, 'foo..'))).toBe(true);
    expect(inside(project, resolve(project, '...'))).toBe(true);
    expect(inside(project, resolve(project, 'dir/..openapi.json'))).toBe(true);
    // x/../y leaves x and lands inside the project again
    expect(inside(project, resolve(project, 'x/../y'))).toBe(true);
    expect(inside(project, resolve(project, '..'))).toBe(false);
    expect(inside(project, resolve(project, '../x'))).toBe(false);
    expect(inside(project, resolve(project, 'x/../..'))).toBe(false);
    // x/.. is the project itself, which is not strictly inside it
    expect(inside(project, resolve(project, 'x/..'))).toBe(false);
    expect(inside(project, project)).toBe(false);
  });

  it('uses the platform separator for the parent segment', () => {
    expect(inside(project, resolve(project, `x${sep}..${sep}y`))).toBe(true);
    expect(inside(project, resolve(project, `..${sep}outside.json`))).toBe(false);
    expect(inside(project, resolve(project, `dir${sep}..openapi.json`))).toBe(true);
  });

  it.runIf(process.platform === 'win32')('treats a backslash parent segment as a parent on Windows', () => {
    expect(inside(project, resolve(project, '..\\outside.json'))).toBe(false);
    expect(inside(project, resolve(project, '..foo\\inside.json'))).toBe(true);
    expect(inside('C:\\project', 'c:\\PROJECT\\inside.json')).toBe(true);
    expect(inside('C:\\project', 'D:\\project\\inside.json')).toBe(false);
  });
});
