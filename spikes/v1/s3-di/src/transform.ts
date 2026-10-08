/**
 * S3 spike: constructor DI metadata transform (oxc, runs before SWC).
 *
 * For every class with an own constructor implementation it emits
 *   __laratype_deps(Cls, [slot, ...], { params, optional? })
 * where a slot is either a lazy thunk `() => Dep` (value binding or `@Inject(token)`)
 * or a positional marker `{ unresolved: "TypeText", index }` (primitives, interfaces,
 * `import type`, type params, unions, globals...). Params are never skipped, so
 * indices always line up with the real constructor.
 *
 * Only erasable TS syntax is used so the file runs under `node --experimental-strip-types`.
 */
import { parseSync } from 'oxc-parser';
import MagicString from 'magic-string';

export const HELPER = '__laratype_deps';
export const VIRTUAL_ID = 'virtual:laratype/di';
export const DEFAULT_CLASS_NAME = '__laratype_default';

export interface TransformOptions {
  /** Module the helper is imported from. */
  helperId?: string;
  /**
   * `direct`: `() => Foo` keeps the user's `import { Foo }` alive (ESM link error if Foo is an interface).
   * `namespace`: adds `import * as __di_ns0 from './x'` and emits `() => __di_ns0.Foo`, so a type-only
   * export degrades to `undefined` (runtime diagnostic) instead of a link error.
   */
  importStrategy?: 'direct' | 'namespace';
  /** Local names (after import aliasing) of the `@Inject` decorator, besides imports named `Inject`. */
  injectNames?: string[];
  /** Benchmark knob: skip the `constructor` substring pre-check and always parse. */
  alwaysParse?: boolean;
}

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
  classes: number;
}

type Node = any;

/** 'value' = has a runtime binding; 'type' = erased; 'enum' = value but not injectable. */
type BindingKind = 'value' | 'type' | 'enum' | 'typeParam';

interface Binding {
  kind: BindingKind;
  /** Set for imports: used by the namespace strategy and `@Inject` alias detection. */
  importSource?: string;
  importedName?: string;
}

type Scope = Map<string, Binding>;

type Slot =
  | { thunk: string }
  | { unresolved: string };

const UNRESOLVABLE_TYPES = new Set([
  'TSStringKeyword', 'TSNumberKeyword', 'TSBooleanKeyword', 'TSBigIntKeyword', 'TSSymbolKeyword',
  'TSAnyKeyword', 'TSUnknownKeyword', 'TSObjectKeyword', 'TSNeverKeyword', 'TSVoidKeyword',
  'TSUndefinedKeyword', 'TSNullKeyword',
]);

export function transform(code: string, id: string, options: TransformOptions = {}): TransformResult | null {
  // Fast pre-check: only classes with an own constructor emit anything.
  if (!options.alwaysParse && !code.includes('constructor')) return null;

  const helperId = options.helperId ?? VIRTUAL_ID;
  const strategy = options.importStrategy ?? 'direct';
  const injectNames = new Set(options.injectNames ?? []);

  const { program, errors } = parseSync(id, code, { sourceType: 'module', lang: id.endsWith('x') ? 'tsx' : 'ts' });
  if (errors.length) {
    // Let SWC report syntax errors with its own diagnostics.
    return null;
  }

  const s = new MagicString(code);
  const scopes: Scope[] = [];
  const nsImports = new Map<string, string>();
  let classes = 0;

  const lookup = (name: string): Binding | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const b = scopes[i].get(name);
      if (b) return b;
    }
    return undefined;
  };

  const declare = (scope: Scope, name: string, binding: Binding) => {
    const prev = scope.get(name);
    // Declaration merging (interface Foo + class Foo): the value side wins.
    if (prev && prev.kind === 'value' && binding.kind === 'type') return;
    scope.set(name, binding);
  };

  const declarePattern = (scope: Scope, pattern: Node) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier': declare(scope, pattern.name, { kind: 'value' }); break;
      case 'TSParameterProperty': declarePattern(scope, pattern.parameter); break;
      case 'AssignmentPattern': declarePattern(scope, pattern.left); break;
      case 'RestElement': declarePattern(scope, pattern.argument); break;
      case 'ArrayPattern': pattern.elements.forEach((e: Node) => declarePattern(scope, e)); break;
      case 'ObjectPattern':
        pattern.properties.forEach((p: Node) => declarePattern(scope, p.type === 'RestElement' ? p : p.value));
        break;
    }
  };

  /** Hoist the declarations of one statement list into `scope` (shallow; `var` in nested blocks is ignored). */
  const collect = (scope: Scope, statements: Node[]) => {
    for (let stmt of statements) {
      if (stmt.type === 'ImportDeclaration') {
        const typeOnlyDecl = stmt.importKind === 'type';
        for (const spec of stmt.specifiers) {
          const typeOnly = typeOnlyDecl || spec.importKind === 'type';
          const importedName = spec.type === 'ImportSpecifier'
            ? (spec.imported.name ?? spec.imported.value)
            : spec.type === 'ImportDefaultSpecifier' ? 'default' : '*';
          declare(scope, spec.local.name, {
            kind: typeOnly ? 'type' : 'value',
            importSource: stmt.source.value,
            importedName,
          });
        }
        continue;
      }
      if (stmt.type === 'TSImportEqualsDeclaration') {
        declare(scope, stmt.id.name, { kind: stmt.importKind === 'type' ? 'type' : 'value' });
        continue;
      }
      if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration) {
        stmt = stmt.declaration;
      }
      switch (stmt.type) {
        case 'ClassDeclaration':
        case 'FunctionDeclaration':
          if (stmt.id && !stmt.declare) declare(scope, stmt.id.name, { kind: 'value' });
          break;
        case 'VariableDeclaration':
          if (!stmt.declare) stmt.declarations.forEach((d: Node) => declarePattern(scope, d.id));
          break;
        case 'TSInterfaceDeclaration':
        case 'TSTypeAliasDeclaration':
          declare(scope, stmt.id.name, { kind: 'type' });
          break;
        case 'TSEnumDeclaration':
          declare(scope, stmt.id.name, { kind: stmt.declare ? 'type' : 'enum' });
          break;
        case 'TSModuleDeclaration':
          if (stmt.id.type === 'Identifier') declare(scope, stmt.id.name, { kind: stmt.declare ? 'type' : 'value' });
          break;
      }
    }
  };

  const isInjectDecorator = (dec: Node): Node | null => {
    const expr = dec.expression;
    if (expr.type !== 'CallExpression' || expr.arguments.length === 0) return null;
    const callee = expr.callee;
    let name: string | undefined;
    if (callee.type === 'Identifier') {
      const b = lookup(callee.name);
      if (callee.name === 'Inject' || injectNames.has(callee.name) || b?.importedName === 'Inject') name = callee.name;
    } else if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'Inject') {
      name = 'Inject';
    }
    return name ? expr.arguments[0] : null;
  };

  const valueRef = (name: string, binding: Binding): string => {
    if (strategy === 'namespace' && binding.importSource && binding.importedName !== '*') {
      let ns = nsImports.get(binding.importSource);
      if (!ns) {
        ns = `__di_ns${nsImports.size}`;
        nsImports.set(binding.importSource, ns);
      }
      return binding.importedName === 'default' ? `${ns}.default` : `${ns}[${JSON.stringify(binding.importedName)}]`;
    }
    return name;
  };

  /** Resolve a type annotation to a slot. */
  const typeToSlot = (type: Node | null | undefined): Slot => {
    if (!type) return { unresolved: 'unknown' };
    const text = code.slice(type.start, type.end);
    if (type.type === 'TSUnionType') {
      // `Foo | undefined` / `Foo | null` -> Foo (optional-ish); any other union stays unresolved.
      const rest = type.types.filter((t: Node) => t.type !== 'TSUndefinedKeyword' && t.type !== 'TSNullKeyword');
      return rest.length === 1 ? typeToSlot(rest[0]) : { unresolved: text };
    }
    if (UNRESOLVABLE_TYPES.has(type.type) || type.type !== 'TSTypeReference') return { unresolved: text };

    const typeName = type.typeName;
    if (typeName.type === 'Identifier') {
      const binding = lookup(typeName.name);
      // Unbound names are globals (Date, Map, Promise, Record...). Flagged for T1: kept unresolved.
      if (!binding || binding.kind !== 'value') return { unresolved: text };
      return { thunk: valueRef(typeName.name, binding) };
    }
    if (typeName.type === 'TSQualifiedName') {
      let root = typeName;
      while (root.type === 'TSQualifiedName') root = root.left;
      if (root.type !== 'Identifier') return { unresolved: text };
      const binding = lookup(root.name);
      if (!binding || binding.kind !== 'value') return { unresolved: text };
      return { thunk: code.slice(typeName.start, typeName.end) };
    }
    return { unresolved: text };
  };

  const paramInfo = (param: Node, index: number) => {
    let p = param.type === 'TSParameterProperty' ? param.parameter : param;
    const decorators: Node[] = [...(param.decorators ?? []), ...(p.decorators ?? [])];
    let optional = false;
    if (p.type === 'AssignmentPattern') {
      optional = true;
      p = p.left;
    }
    if (p.optional) optional = true;
    const name = p.type === 'Identifier' ? p.name : `#${index}`;
    return { name, typeAnnotation: p.typeAnnotation?.typeAnnotation, decorators, optional };
  };

  const emitFor = (cls: Node): string | null => {
    if (cls.declare) return null;
    const ctor = cls.body.body.find((m: Node) =>
      m.type === 'MethodDefinition' && m.kind === 'constructor' && m.value.body);
    // No own constructor: emit nothing, the runtime walks the parent chain.
    if (!ctor) return null;
    const params: Node[] = ctor.value.params;
    // `constructor(...args) { super(...args) }` is a pass-through: treat as "no own constructor".
    if (params.length > 0 && params[0].type === 'RestElement') return null;

    const slots: string[] = [];
    const names: string[] = [];
    const optional: number[] = [];
    params.forEach((param, index) => {
      if (param.type === 'RestElement') return; // trailing rest gets nothing injected
      const info = paramInfo(param, index);
      names.push(info.name);
      if (info.optional) optional.push(index);
      const token = info.decorators.map(isInjectDecorator).find(Boolean);
      if (token) {
        slots.push(`() => ${code.slice(token.start, token.end)}`);
        return;
      }
      const slot = typeToSlot(info.typeAnnotation);
      slots.push('thunk' in slot
        ? `() => ${slot.thunk}`
        : `{ unresolved: ${JSON.stringify(slot.unresolved)}, index: ${index} }`);
    });
    const meta = `{ params: ${JSON.stringify(names)}${optional.length ? `, optional: ${JSON.stringify(optional)}` : ''} }`;
    return `[${slots.join(', ')}], ${meta}`;
  };

  /** Find the position right after the `class` keyword (skips decorators / `export default`). */
  const classKeywordEnd = (cls: Node): number => {
    const from = Math.max(cls.start, ...(cls.decorators ?? []).map((d: Node) => d.end));
    const re = /\bclass\b/g;
    re.lastIndex = from;
    const m = re.exec(code);
    return m ? m.index + m[0].length : from;
  };

  const visitClass = (cls: Node, parent: Node, grandParent: Node) => {
    // Class type params shadow outer bindings inside the constructor signature.
    const typeScope: Scope = new Map();
    for (const tp of cls.typeParameters?.params ?? []) typeScope.set(tp.name.name, { kind: 'typeParam' });
    scopes.push(typeScope);
    const args = emitFor(cls);
    scopes.pop();

    if (args) {
      classes++;
      if (cls.type === 'ClassDeclaration') {
        let name = cls.id?.name;
        if (!name) {
          // Anonymous `export default class {}`: give it a binding so the call can reference it.
          name = DEFAULT_CLASS_NAME;
          s.appendLeft(classKeywordEnd(cls), ` ${name}`);
        }
        s.appendLeft(cls.end, `\n${HELPER}(${name}, ${args});`);
      } else if (parent?.type === 'VariableDeclarator' && parent.init === cls && parent.id.type === 'Identifier'
        && grandParent?.type === 'VariableDeclaration') {
        // `const X = class {}`: keep name inference, register after the declaration.
        s.appendLeft(grandParent.end, `\n${HELPER}(${parent.id.name}, ${args});`);
      } else {
        // Any other class expression: wrap. The class loses name inference (`.name === ""`).
        s.prependRight(cls.start, `${HELPER}(`);
        s.appendLeft(cls.end, `, ${args})`);
      }
    }
  };

  // Generic walk with scope tracking. `parent` / `grandParent` are kept for class-expression placement.
  const walk = (node: Node, parent: Node, grandParent: Node) => {
    if (!node || typeof node.type !== 'string') return;
    let pushed = false;
    switch (node.type) {
      case 'Program':
      case 'BlockStatement':
      case 'StaticBlock':
      case 'TSModuleBlock':
        scopes.push(new Map());
        pushed = true;
        collect(scopes[scopes.length - 1], node.body);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const scope: Scope = new Map();
        node.params.forEach((p: Node) => declarePattern(scope, p));
        for (const tp of node.typeParameters?.params ?? []) scope.set(tp.name.name, { kind: 'typeParam' });
        if (node.type === 'FunctionExpression' && node.id) declare(scope, node.id.name, { kind: 'value' });
        scopes.push(scope);
        pushed = true;
        break;
      }
      case 'ClassDeclaration':
      case 'ClassExpression':
        visitClass(node, parent, grandParent);
        break;
    }
    for (const key in node) {
      if (key === 'parent' || key === 'start' || key === 'end' || key === 'type') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === 'string') walk(c, node, parent);
      } else if (child && typeof child.type === 'string') {
        walk(child, node, parent);
      }
    }
    if (pushed) scopes.pop();
  };

  walk(program, null, null);
  if (classes === 0) return null;

  let header = `import { ${HELPER} } from ${JSON.stringify(helperId)};`;
  for (const [source, ns] of nsImports) header += `import * as ${ns} from ${JSON.stringify(source)};`;
  s.prepend(header + '\n');

  return {
    code: s.toString(),
    map: s.generateMap({ source: id, file: id, includeContent: true, hires: 'boundary' }),
    classes,
  };
}
