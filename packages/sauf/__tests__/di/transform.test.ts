import { describe, expect, it } from 'vitest';
import { transformSync } from '@swc/core';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { DI_DEFAULT_CLASS_NAME, transformDi } from '../../src/di';
import { warmupSwcOptions } from './support/pipeline';

// Targeted unit cases: options, pre-checks, source maps, and edge cases that need no runtime.
// End-to-end behaviour + output snapshots per edge case live in `fixtures.test.ts`.

const HEADER ='import { __laratype_deps } from "virtual:laratype/di";\n';

const run = (code: string, id = '/app/src/main.ts') => transformDi(code, id)?.code ?? null;

/** Every emitted `__laratype_deps(...)` argument list after the class (statement form). */
const calls = (code: string, id?: string) => {
  const out = run(code, id);
  if (out === null) return null;
  return [...out.matchAll(/__laratype_deps\((\w+), (.*)\);$/gm)].map(([, name, args]) => `${name}: ${args}`);
};

describe('transformDi', () => {
  describe('pre-checks', () => {
    it('returns null when the file has no `constructor`', () => {
      expect(run('export class A { method() {} }')).toBeNull();
    });

    it('returns null when no class has an own constructor', () => {
      expect(run('// constructor\nexport class A extends B {}')).toBeNull();
    });

    it('returns null on syntax errors so SWC reports them', () => {
      expect(run('class A { constructor(a: A) {')).toBeNull();
    });
  });

  describe('slots', () => {
    it('emits a thunk for local classes and value imports', () => {
      expect(calls(`
        import { Repo } from './repo';
        import Logger from './logger';
        import * as ns from './ns';
        class Local {}
        export class Svc {
          constructor(private readonly repo: Repo, public logger: Logger, local: Local, q: ns.Mailer) {}
        }
      `)).toEqual([
        'Svc: [() => Repo, () => Logger, () => Local, () => ns.Mailer], { params: ["repo","logger","local","q"] }',
      ]);
    });

    it('marks everything without a runtime value as unresolved, never skipping a param', () => {
      expect(calls(`
        import type { Cache } from './cache';
        import { type Real as RealType } from './real';
        interface Iface {}
        type Alias = {};
        enum Mode { A }
        const enum Flag { B }
        declare class Ambient {}
        class A {
          constructor(a: string, b: Iface, c: Alias, d: Cache, e: RealType, f: Mode, g: Flag, h: Ambient, i: Foo | string,
            j: () => void, k: typeof x, l: 'lit', m: Mode.A, n: import('./x').Y, o) {}
        }
      `)).toEqual([
        'A: [{ unresolved: "string", index: 0 }, { unresolved: "Iface", index: 1 }, { unresolved: "Alias", index: 2 }, '
        + '{ unresolved: "Cache", index: 3 }, { unresolved: "RealType", index: 4 }, { unresolved: "Mode", index: 5 }, '
        + '{ unresolved: "Flag", index: 6 }, { unresolved: "Ambient", index: 7 }, { unresolved: "Foo | string", index: 8 }, '
        + '{ unresolved: "() => void", index: 9 }, { unresolved: "typeof x", index: 10 }, { unresolved: "\'lit\'", index: 11 }, '
        + '{ unresolved: "Mode.A", index: 12 }, { unresolved: "import(\'./x\').Y", index: 13 }, { unresolved: "unknown", index: 14 }], '
        + '{ params: ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o"] }',
      ]);
    });

    it('keeps a class merged with an interface injectable', () => {
      expect(calls('interface Dep { x: 1 }\nclass Dep {}\nclass A { constructor(d: Dep) {} }'))
        .toEqual(['A: [() => Dep], { params: ["d"] }']);
    });

    it('treats a value with a same-named type alias as unresolved (e.g. zod schema + inferred type)', () => {
      expect(calls('const User = schema();\ntype User = Infer<typeof User>;\nclass A { constructor(u: User) {} }'))
        .toEqual(['A: [{ unresolved: "User", index: 0 }], { params: ["u"] }']);
    });

  });

  describe('carried from S3 (#101)', () => {
    it('a local class named like a global wins', () => {
      expect(calls('class Map {}\nclass A { constructor(m: Map) {} }')).toEqual(['A: [() => Map], { params: ["m"] }']);
    });

    it('marks `Foo | undefined` / `Foo | null` optional', () => {
      expect(calls('class Foo {}\nclass A { constructor(a: Foo | undefined, b: (null | Foo), c: Foo | null | undefined, d: Foo) {} }'))
        .toEqual(['A: [() => Foo, () => Foo, () => Foo, () => Foo], { params: ["a","b","c","d"], optional: [0,1,2] }']);
    });

    it('keeps name inference for assignments, object properties and class fields', () => {
      const out = run(`
        class Dep {}
        X = class { constructor(d: Dep) {} };
        Y ||= class { constructor(d: Dep) {} };
        const o = { Key: class { constructor(d: Dep) {} }, 'k-2': class { constructor(d: Dep) {} }, 3: class { constructor(d: Dep) {} } };
        class Holder { static Inner = class { constructor(d: Dep) {} }; #priv = class { constructor(d: Dep) {} }; }
        function f(P = class { constructor(d: Dep) {} }) {}
        const Casted = (class { constructor(d: Dep) {} }) as any;
        export default (class { constructor(d: Dep) {} });
      `)!;
      for (const key of ['X', 'Y', 'Key', 'k-2', '3', 'Inner', '#priv', 'P', 'Casted', 'default']) {
        expect(out).toContain(`__laratype_deps({ ${JSON.stringify(key)}: class { constructor(d: Dep) {} } }[${JSON.stringify(key)}], [() => Dep]`);
      }
    });

    it('plain-wraps class expressions without name inference', () => {
      const out = run(`
        class Dep {}
        register(class { constructor(d: Dep) {} });
        const N = class Own { constructor(d: Dep) {} };
        o[k] = class { constructor(d: Dep) {} };
        this.x = class { constructor(d: Dep) {} };
      `)!;
      expect(out).toContain('register(__laratype_deps(class { constructor(d: Dep) {} }, [() => Dep], { params: ["d"] }));');
      expect(out).toContain('const N = __laratype_deps(class Own { constructor(d: Dep) {} }, [() => Dep], { params: ["d"] });');
      expect(out).toContain('o[k] = __laratype_deps(class { constructor(d: Dep) {} }, [() => Dep], { params: ["d"] });');
      expect(out).toContain('this.x = __laratype_deps(class { constructor(d: Dep) {} }, [() => Dep], { params: ["d"] });');
    });

    it('hoists `var` out of nested blocks for shadowing', () => {
      expect(calls(`
        class Dep {}
        function f() {
          try { for (;;) { if (x) { var Dep = 1; } } } finally {}
          class A { constructor(d: Dep) {} }
        }
        function g() {
          { let Dep = 1; }
          class B { constructor(d: Dep) {} }
        }
      `)).toEqual([
        'A: [{ unresolved: "Dep", index: 0 }], { params: ["d"] }',
        'B: [() => Dep], { params: ["d"] }',
      ]);
    });

    it('sees `var` hoisted from a nested block as a value (qualified names)', () => {
      expect(calls('function f() {\n  if (x) { var ns = make(); }\n  class A { constructor(m: ns.Mailer) {} }\n}'))
        .toEqual(['A: [() => ns.Mailer], { params: ["m"] }']);
    });

    it('parses TSX', () => {
      const code = [
        'import { Dep } from "./dep";',
        'export const View = <T,>(p: { x: T }) => <div class="x">{String(p.x)}</div>;',
        'export class Page {',
        '  constructor(public dep: Dep) {}',
        '  render() { return <View x={1} />; }',
        '}',
      ].join('\n');
      expect(calls(code, '/app/src/Page.tsx')).toEqual(['Page: [() => Dep], { params: ["dep"] }']);
      // Same text as `.ts` is a syntax error (JSX), so it is left to SWC.
      expect(run(code, '/app/src/Page.ts')).toBeNull();
      // `<T>x` is a type assertion in `.ts`.
      expect(calls('class Dep {}\nconst d = <any>null;\nclass A { constructor(x: Dep) {} }', '/app/a.ts?v=1'))
        .toEqual(['A: [() => Dep], { params: ["x"] }']);
    });

    describe('source maps', () => {
      const code = [
        '#!/usr/bin/env node',
        '// Tiếng Việt 🚀',
        'import { Dep } from "./dep";',
        '',
        'export const Expr = class {',
        '  constructor(public dep: Dep) {}',
        '};',
        '',
        'export default class {',
        '  constructor(public dep: Dep) {}',
        '  /* 日本語 */ greet() { return "😀"; }',
        '}',
      ].join('\n');
      const id = '/app/src/main.ts';

      /** Generated position of the n-th occurrence of `needle`. */
      const position = (text: string, needle: string, nth = 0) => {
        let index = -1;
        for (let i = 0; i <= nth; i++) index = text.indexOf(needle, index + 1);
        expect(index, `${needle} #${nth}`).toBeGreaterThan(-1);
        const lines = text.slice(0, index).split('\n');
        return { line: lines.length, column: lines[lines.length - 1].length };
      };

      const expectMapped = (map: TraceMap, generated: string, needle: string, nth = 0) => {
        const original = originalPositionFor(map, position(generated, needle, nth));
        expect(original.source).toContain('main.ts');
        expect({ line: original.line, column: original.column }).toEqual(position(code, needle, nth));
      };

      it('maps original tokens through the DI transform (hires: boundary, UTF-16 offsets)', () => {
        const result = transformDi(code, id)!;
        const map = new TraceMap(result.map.toString());
        expect(result.code.startsWith(`#!/usr/bin/env node\n// Tiếng Việt 🚀\n${HEADER}`)).toBe(true);
        expect(result.code).toContain(`export default class ${DI_DEFAULT_CLASS_NAME} {`);
        for (const [needle, nth] of [['constructor', 0], ['constructor', 1], ['public dep', 1], ['greet', 0], ['"😀"', 0]] as const) {
          expectMapped(map, result.code, needle, nth);
        }
      });

      it('stays accurate when chained through SWC (inputSourceMap)', () => {
        const di = transformDi(code, id)!;
        const swc = transformSync(di.code, {
          ...warmupSwcOptions(),
          filename: id,
          inputSourceMap: di.map.toString(),
        });
        const map = new TraceMap(swc.map!);
        for (const [needle, nth] of [['constructor', 0], ['constructor', 1], ['greet', 0], ['"😀"', 0]] as const) {
          expectMapped(map, swc.code, needle, nth);
        }
      });
    });
  });

  describe('constructors', () => {
    it('only emits for classes with an own constructor implementation', () => {
      expect(calls(`
        class Base { constructor(a: Base) {} }
        class NoCtor extends Base { x = 1 }
        class Overloads {
          constructor(a: string);
          constructor(a: Base);
          constructor(a: Base | string) {}
        }
        declare class Ambient { constructor(a: Base); }
        abstract class Abstract { constructor(a: Base) {} }
      `)).toEqual([
        'Base: [() => Base], { params: ["a"] }',
        'Overloads: [{ unresolved: "Base | string", index: 0 }], { params: ["a"] }',
        'Abstract: [() => Base], { params: ["a"] }',
      ]);
    });

  });

  describe('@Inject', () => {
    it('uses the token for Inject, aliased imports, configured names and member access', () => {
      const out = transformDi(`
        import { Inject as Use } from '@laratype/di';
        import type { Mailer } from './mailer';
        class A {
          constructor(@Inject(MAILER) a: Mailer, @Use('app.name') b: string, @di.Inject(TOKENS.c) c: unknown,
            @InjectLogger() d: unknown, @Other(X) e: string, @Inject(OPT) f?: Mailer) {}
        }
      `, '/a.ts', { injectNames: ['InjectLogger'] })!.code;
      expect(out).toContain(
        '__laratype_deps(A, [() => MAILER, () => \'app.name\', () => TOKENS.c, { unresolved: "unknown", index: 3 }, '
        + '{ unresolved: "string", index: 4 }, () => OPT], { params: ["a","b","c","d","e","f"], optional: [5] });',
      );
    });

  });

  describe('placement and scopes', () => {
    it('imports the helper once, after directives, from a configurable id', () => {
      const out = transformDi('"use strict";\nclass A { constructor() {} }\nclass B { constructor() {} }', '/a.ts', {
        helperId: '@laratype/core/di',
      })!.code;
      expect(out.startsWith('"use strict";\nimport { __laratype_deps } from "@laratype/core/di";\nclass A')).toBe(true);
      expect(out.match(/import \{ __laratype_deps \}/g)).toHaveLength(1);
    });

    it('aliases the helper when the file already uses its name, and never emits internal names like `bind`', () => {
      const plain = run('function bind() {}\nclass Dep {}\nclass A { constructor(d: Dep) {} }')!;
      expect(plain).toContain(HEADER);
      expect(plain).toContain('\n__laratype_deps(A, [() => Dep], { params: ["d"] });');
      expect(plain.match(/\bbind\b/g)).toHaveLength(1);

      const out = run('const __laratype_deps = 1, __laratype_deps_1 = 2;\nclass Dep {}\nclass A { constructor(d: Dep) {} }')!;
      expect(out).toContain('import { __laratype_deps as __laratype_deps_2 } from "virtual:laratype/di";\n');
      expect(out).toContain('\n__laratype_deps_2(A, [() => Dep], { params: ["d"] });');

      // Mentions in strings and comments are not identifiers: no alias.
      expect(run('// __laratype_deps\nlog("__laratype_deps");\nclass A { constructor() {} }')).toContain(HEADER);
    });

    it('handles named and anonymous export default classes (decorated too)', () => {
      expect(calls('class Dep {}\nexport default class Named { constructor(d: Dep) {} }'))
        .toEqual(['Named: [() => Dep], { params: ["d"] }']);
      const out = run('class Dep {}\n@Injectable() /* class */ export default abstract class<T> { constructor(d: Dep) {} }')!;
      expect(out).toContain(`export default abstract class ${DI_DEFAULT_CLASS_NAME}<T> {`);
      expect(out).toContain(`}\n__laratype_deps(${DI_DEFAULT_CLASS_NAME}, [() => Dep], { params: ["d"] });`);
    });

    it('places the call after a decorated class declaration', () => {
      expect(run('class Dep {}\n@Injectable()\nexport class Svc {\n  constructor(d: Dep) {}\n}\nfoo();'))
        .toContain('export class Svc {\n  constructor(d: Dep) {}\n}\n__laratype_deps(Svc, [() => Dep], { params: ["d"] });\nfoo();');
    });

    it('resolves type params, nested classes and function scopes', () => {
      expect(calls(`
        class Dep {}
        class Box<Dep> {
          constructor(d: Dep) {}
          method() {
            class Inner { constructor(d: Dep) {} }
          }
        }
        function make<T>(Dep: number) {
          class Local {}
          class UsesLocal { constructor(l: Local, t: T) {} }
          class Shadowed { constructor(d: Dep) {} }
        }
        namespace NS {
          export class Svc { constructor(d: Dep) {} }
        }
      `)).toEqual([
        // Inner is emitted inside Box's body, so it comes first.
        'Inner: [{ unresolved: "Dep", index: 0 }], { params: ["d"] }',
        'Box: [{ unresolved: "Dep", index: 0 }], { params: ["d"] }',
        'UsesLocal: [() => Local, { unresolved: "T", index: 1 }], { params: ["l","t"] }',
        'Shadowed: [{ unresolved: "Dep", index: 0 }], { params: ["d"] }',
        'Svc: [() => Dep], { params: ["d"] }',
      ]);
    });

    it('does not reference a named class expression\'s own name from outside it', () => {
      expect(run('const X = class Self { constructor(s: Self) {} };'))
        .toContain('[{ unresolved: "Self", index: 0 }]');
    });
  });
});
