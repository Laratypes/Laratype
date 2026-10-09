/**
 * Constructor DI metadata transform (oxc, runs before SWC).
 *
 * For every class with an own constructor implementation it emits
 *   __laratype_deps(Cls, [slot, ...], { params, optional? })
 * where a slot is a lazy thunk `() => Dep` (value binding or `@Inject(token)`)
 * or a positional marker `{ unresolved: "TypeText", index }` (primitives, interfaces,
 * `import type`, type params, unions, globals...). Params are never skipped, so
 * indices always line up with the real constructor.
 *
 * Ported from the S3 spike (#86, `spikes/v1/s3-di`).
 */
import { parseSync, visitorKeys } from 'oxc-parser';
import MagicString, { type SourceMap } from 'magic-string';

export const DI_HELPER = '__laratype_deps';
export const DI_VIRTUAL_ID = 'virtual:laratype/di';
/** Binding name given to an anonymous `export default class {}` so the helper call can reference it. */
export const DI_DEFAULT_CLASS_NAME = '__laratype_default';

export interface DiTransformOptions {
  /** Module the helper is imported from. Defaults to `virtual:laratype/di`. */
  helperId?: string;
  /** Extra local names of the `@Inject` decorator, besides `Inject` and imports named `Inject`. */
  injectNames?: string[];
}

export interface DiTransformResult {
  code: string;
  map: SourceMap;
}

/** oxc ESTree node. The walker is generic over node shapes, so nodes are kept untyped. */
type AstNode = any;

/**
 * What a name means in each TS namespace.
 * value: `class` | `enum` | `import` (value import, could be anything) | `other` (var/let/const/function/param/namespace)
 * type: `class` | `enum` | `import` | `alias` (interface/type alias/type-only import/ambient) | `typeParam`
 */
interface Binding {
  value?: 'class' | 'enum' | 'import' | 'other';
  type?: 'class' | 'enum' | 'import' | 'alias' | 'typeParam';
  importedName?: string;
}

type Scope = Map<string, Binding>;

interface Slot {
  /** Expression for `() => <thunk>`; absent means unresolved. */
  thunk?: string;
  /** Type text for the `{ unresolved }` marker. */
  text: string;
  /** `Foo | undefined` / `Foo | null`. */
  nullable: boolean;
}

const TYPE_PRIORITY: Record<NonNullable<Binding['type']>, number> = {
  typeParam: 0, alias: 1, enum: 2, import: 3, class: 4,
};

/** TS-only expression wrappers that are erased, so they don't block name inference. */
const ERASED_WRAPPERS = new Set([
  'ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion',
]);

const ASSIGNMENT_NAMING_OPERATORS = new Set(['=', '||=', '&&=', '??=']);

const cleanId = (id: string) => id.replace(/[?#].*$/, '');

const langOf = (id: string): 'ts' | 'tsx' | 'js' | 'jsx' => {
  const ext = /\.([cm]?[jt]sx?)$/.exec(cleanId(id))?.[1] ?? 'ts';
  if (ext.endsWith('x')) return ext.startsWith('t') ? 'tsx' : 'jsx';
  return ext.endsWith('ts') ? 'ts' : 'js';
};

/** Names of all identifiers in the tree starting with `prefix` (strings and comments don't count). */
const identifiersWithPrefix = (root: AstNode, prefix: string): Set<string> => {
  const names = new Set<string>();
  const visit = (node: AstNode) => {
    if (node.type === 'Identifier' && node.name.startsWith(prefix)) names.add(node.name);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === 'string') visit(c);
      } else if (child && typeof child.type === 'string') {
        visit(child);
      }
    }
  };
  visit(root);
  return names;
};

export function transformDi(code: string, id: string, options: DiTransformOptions = {}): DiTransformResult | null {
  // Fast pre-check: only classes with an own constructor emit anything.
  if (!code.includes('constructor')) return null;

  const helperId = options.helperId ?? DI_VIRTUAL_ID;
  const injectNames = new Set(['Inject', ...(options.injectNames ?? [])]);

  const { program, errors } = parseSync(cleanId(id), code, { sourceType: 'module', lang: langOf(id) });
  // Let SWC report syntax errors with its own diagnostics.
  if (errors.length) return null;

  // Local name of the helper: aliased if the file already has an identifier `__laratype_deps` (e.g. declares its own).
  let helper = DI_HELPER;
  if (code.includes(DI_HELPER)) {
    const taken = identifiersWithPrefix(program, DI_HELPER);
    for (let n = 1; taken.has(helper); n++) helper = `${DI_HELPER}_${n}`;
  }

  const s = new MagicString(code);
  const scopes: Scope[] = [];
  const ancestors: AstNode[] = [];
  let emitted = 0;

  const bind = (scope: Scope, name: string, binding: Binding) => {
    const prev = scope.get(name);
    if (!prev) {
      scope.set(name, { ...binding });
      return;
    }
    // Declaration merging (`interface Foo` + `class Foo`, `const X` + `type X`...).
    if (binding.value) prev.value = binding.value;
    if (binding.type && (!prev.type || TYPE_PRIORITY[binding.type] >= TYPE_PRIORITY[prev.type])) prev.type = binding.type;
    if (binding.importedName) prev.importedName = binding.importedName;
  };

  const declarePattern = (scope: Scope, pattern: AstNode) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier': bind(scope, pattern.name, { value: 'other' }); break;
      case 'TSParameterProperty': declarePattern(scope, pattern.parameter); break;
      case 'AssignmentPattern': declarePattern(scope, pattern.left); break;
      case 'RestElement': declarePattern(scope, pattern.argument); break;
      case 'ArrayPattern': pattern.elements.forEach((e: AstNode) => declarePattern(scope, e)); break;
      case 'ObjectPattern':
        pattern.properties.forEach((p: AstNode) => declarePattern(scope, p.type === 'RestElement' ? p : p.value));
        break;
    }
  };

  /** Declarations of one statement list that are scoped to it (lexical + imports + types). */
  const collect = (scope: Scope, statements: AstNode[]) => {
    for (let stmt of statements) {
      if (stmt.type === 'ImportDeclaration') {
        for (const spec of stmt.specifiers) {
          const importedName = spec.type === 'ImportSpecifier'
            ? (spec.imported.name ?? spec.imported.value)
            : spec.type === 'ImportDefaultSpecifier' ? 'default' : '*';
          const typeOnly = stmt.importKind === 'type' || spec.importKind === 'type';
          bind(scope, spec.local.name, typeOnly
            ? { type: 'alias', importedName }
            : { value: 'import', type: 'import', importedName });
        }
        continue;
      }
      if (stmt.type === 'TSImportEqualsDeclaration') {
        bind(scope, stmt.id.name, stmt.importKind === 'type' ? { type: 'alias' } : { value: 'import', type: 'import' });
        continue;
      }
      if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration) {
        stmt = stmt.declaration;
      }
      switch (stmt.type) {
        case 'ClassDeclaration':
          // An ambient class is treated like a global: no binding we can rely on.
          if (stmt.id) bind(scope, stmt.id.name, stmt.declare ? { type: 'alias' } : { value: 'class', type: 'class' });
          break;
        case 'FunctionDeclaration':
          if (stmt.id && !stmt.declare) bind(scope, stmt.id.name, { value: 'other' });
          break;
        case 'VariableDeclaration':
          if (!stmt.declare) stmt.declarations.forEach((d: AstNode) => declarePattern(scope, d.id));
          break;
        case 'TSInterfaceDeclaration':
        case 'TSTypeAliasDeclaration':
          bind(scope, stmt.id.name, { type: 'alias' });
          break;
        case 'TSEnumDeclaration':
          // `const enum` / `declare enum` have no runtime object (without preserveConstEnums).
          bind(scope, stmt.id.name, stmt.declare || stmt.const ? { type: 'enum' } : { value: 'enum', type: 'enum' });
          break;
        case 'TSModuleDeclaration':
          if (stmt.id.type === 'Identifier' && !stmt.declare) bind(scope, stmt.id.name, { value: 'other' });
          break;
      }
    }
  };

  /** Hoist `var` declarations out of nested statements (not crossing function boundaries). */
  const hoistVars = (scope: Scope, node: AstNode) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((n) => hoistVars(scope, n));
      return;
    }
    switch (node.type) {
      case 'VariableDeclaration':
        if (node.kind === 'var' && !node.declare) node.declarations.forEach((d: AstNode) => declarePattern(scope, d.id));
        break;
      case 'ExportNamedDeclaration':
        hoistVars(scope, node.declaration);
        break;
      case 'BlockStatement':
        hoistVars(scope, node.body);
        break;
      case 'IfStatement':
        hoistVars(scope, node.consequent);
        hoistVars(scope, node.alternate);
        break;
      case 'ForStatement':
        hoistVars(scope, node.init);
        hoistVars(scope, node.body);
        break;
      case 'ForInStatement':
      case 'ForOfStatement':
        hoistVars(scope, node.left);
        hoistVars(scope, node.body);
        break;
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'LabeledStatement':
        hoistVars(scope, node.body);
        break;
      case 'TryStatement':
        hoistVars(scope, node.block);
        hoistVars(scope, node.handler?.body);
        hoistVars(scope, node.finalizer);
        break;
      case 'SwitchStatement':
        node.cases.forEach((c: AstNode) => hoistVars(scope, c.consequent));
        break;
    }
  };

  const typeParamScope = (typeParameters: AstNode): Scope => {
    const scope: Scope = new Map();
    for (const tp of typeParameters?.params ?? []) bind(scope, tp.name.name, { type: 'typeParam' });
    return scope;
  };

  /** Innermost binding of `name` in the given namespace, with its scope depth. */
  const lookup = (name: string, ns: 'value' | 'type'): { binding: Binding; depth: number } | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const binding = scopes[i].get(name);
      if (binding?.[ns]) return { binding, depth: i };
    }
    return undefined;
  };

  /** The runtime value a type name refers to, or undefined when it has none (or it is shadowed). */
  const valueForType = (name: string): string | undefined => {
    const found = lookup(name, 'type');
    // Unbound names are globals (Date, Map, Promise...): kept unresolved, see `#101` decision.
    if (!found || (found.binding.type !== 'class' && found.binding.type !== 'import')) return undefined;
    // `function f(Dep) { class A { constructor(d: Dep) {} } }`: the thunk would see the param, not the type.
    const value = lookup(name, 'value');
    if (!value || value.depth !== found.depth) return undefined;
    return name;
  };

  const isInjectDecorator = (dec: AstNode): AstNode | null => {
    const expr = dec.expression;
    if (expr.type !== 'CallExpression' || expr.arguments.length === 0) return null;
    const callee = expr.callee;
    if (callee.type === 'Identifier') {
      const imported = lookup(callee.name, 'value')?.binding.importedName;
      return injectNames.has(callee.name) || imported === 'Inject' ? expr.arguments[0] : null;
    }
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'Inject') {
      return expr.arguments[0];
    }
    return null;
  };

  const typeToSlot = (type: AstNode): Slot => {
    if (!type) return { text: 'unknown', nullable: false };
    const text = code.slice(type.start, type.end);
    if (type.type === 'TSParenthesizedType') return typeToSlot(type.typeAnnotation);
    if (type.type === 'TSUnionType') {
      // `Foo | undefined` / `Foo | null` -> Foo, marked optional; any other union stays unresolved.
      const rest = type.types.filter((t: AstNode) => t.type !== 'TSUndefinedKeyword' && t.type !== 'TSNullKeyword');
      if (rest.length === 1 && rest.length < type.types.length) return { ...typeToSlot(rest[0]), nullable: true };
      return { text, nullable: false };
    }
    if (type.type !== 'TSTypeReference') return { text, nullable: false };

    const typeName = type.typeName;
    if (typeName.type === 'Identifier') {
      return { thunk: valueForType(typeName.name), text, nullable: false };
    }
    if (typeName.type === 'TSQualifiedName') {
      let root = typeName;
      while (root.type === 'TSQualifiedName') root = root.left;
      // `ns.Foo` needs `ns` as a runtime object (`import * as ns`, TS namespace, class with static members).
      const value = root.type === 'Identifier' ? lookup(root.name, 'value')?.binding.value : undefined;
      const thunk = value && value !== 'enum' ? code.slice(typeName.start, typeName.end) : undefined;
      return { thunk, text, nullable: false };
    }
    return { text, nullable: false };
  };

  const paramInfo = (param: AstNode, index: number) => {
    const decorators: AstNode[] = [...(param.decorators ?? [])];
    let p = param;
    if (p.type === 'TSParameterProperty') {
      p = p.parameter;
      decorators.push(...(p.decorators ?? []));
    }
    let optional = false;
    if (p.type === 'AssignmentPattern') {
      optional = true;
      p = p.left;
      decorators.push(...(p.decorators ?? []));
    }
    if (p.optional) optional = true;
    const name = p.type === 'Identifier' ? p.name : `#${index}`;
    return { name, typeAnnotation: p.typeAnnotation?.typeAnnotation, decorators, optional };
  };

  /** `[slots], meta` for a class with an own constructor implementation, else null. */
  const depsArgs = (cls: AstNode): string | null => {
    if (cls.declare) return null;
    const ctor = cls.body.body.find((m: AstNode) =>
      m.type === 'MethodDefinition' && m.kind === 'constructor' && m.value.body);
    // No own constructor: emit nothing, the runtime walks the parent chain.
    if (!ctor) return null;
    const params: AstNode[] = ctor.value.params;
    // `constructor(...args) { super(...args) }` is a pass-through: treated as "no own constructor".
    if (params[0]?.type === 'RestElement') return null;

    const slots: string[] = [];
    const names: string[] = [];
    const optional: number[] = [];
    params.forEach((param, index) => {
      // A trailing rest gets nothing injected; it is always last, so indices still line up.
      if (param.type === 'RestElement') return;
      const info = paramInfo(param, index);
      names.push(info.name);
      const token = info.decorators.map(isInjectDecorator).find(Boolean);
      if (token) {
        if (info.optional) optional.push(index);
        slots.push(`() => ${code.slice(token.start, token.end)}`);
        return;
      }
      const slot = typeToSlot(info.typeAnnotation);
      if (info.optional || slot.nullable) optional.push(index);
      slots.push(slot.thunk
        ? `() => ${slot.thunk}`
        : `{ unresolved: ${JSON.stringify(slot.text)}, index: ${index} }`);
    });
    const meta = `{ params: ${JSON.stringify(names)}${optional.length ? `, optional: ${JSON.stringify(optional)}` : ''} }`;
    return `[${slots.join(', ')}], ${meta}`;
  };

  /** Position right after the `class` keyword (skips decorators, `export default`, `abstract`, comments). */
  const classKeywordEnd = (cls: AstNode): number => {
    const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\bclass\b/g;
    re.lastIndex = Math.max(cls.start, ...(cls.decorators ?? []).map((d: AstNode) => d.end));
    for (let m = re.exec(code); m; m = re.exec(code)) {
      if (m[0] === 'class') return m.index + m[0].length;
    }
    throw new Error(`[laratype:di] cannot find the class keyword of the default export in ${id}`);
  };

  /** Name an anonymous class expression would get through NamedEvaluation, if it is statically known. */
  const inferredName = (cls: AstNode): string | undefined => {
    let child = cls;
    let i = ancestors.length - 1;
    while (i >= 0 && ERASED_WRAPPERS.has(ancestors[i].type) && ancestors[i].expression === child) child = ancestors[i--];
    const parent = ancestors[i];
    if (!parent) return undefined;
    const keyName = (key: AstNode, computed: boolean) => {
      if (computed) return undefined;
      if (key.type === 'Identifier') return key.name;
      if (key.type === 'PrivateIdentifier') return `#${key.name}`;
      if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) return String(key.value);
      return undefined;
    };
    switch (parent.type) {
      case 'VariableDeclarator':
        return parent.init === child && parent.id.type === 'Identifier' ? parent.id.name : undefined;
      case 'AssignmentExpression':
        return parent.right === child && parent.left.type === 'Identifier' && ASSIGNMENT_NAMING_OPERATORS.has(parent.operator)
          ? parent.left.name : undefined;
      case 'AssignmentPattern':
        return parent.right === child && parent.left.type === 'Identifier' ? parent.left.name : undefined;
      case 'Property':
        return parent.value === child && parent.kind === 'init' && !parent.method && !parent.shorthand
          ? keyName(parent.key, parent.computed) : undefined;
      case 'PropertyDefinition':
        return parent.value === child ? keyName(parent.key, parent.computed) : undefined;
      case 'ExportDefaultDeclaration':
        return 'default';
    }
    return undefined;
  };

  const emitFor = (cls: AstNode) => {
    const args = depsArgs(cls);
    if (!args) return;
    emitted++;
    if (cls.type === 'ClassDeclaration') {
      let name = cls.id?.name;
      if (!name) {
        // Anonymous `export default class {}`: give it a binding so the call can reference it.
        name = DI_DEFAULT_CLASS_NAME;
        s.appendLeft(classKeywordEnd(cls), ` ${name}`);
      }
      // After the class, so it runs after SWC's `X = _ts_decorate([...], X)` and registers the final binding.
      s.appendLeft(cls.end, `\n${helper}(${name}, ${args});`);
      return;
    }
    const name = cls.id ? undefined : inferredName(cls);
    if (name === undefined) {
      // Named class expression or no name inference: a plain wrap keeps `.name` as it was.
      s.prependRight(cls.start, `${helper}(`);
      s.appendLeft(cls.end, `, ${args})`);
      return;
    }
    // `X = class {}`, `{ X: class {} }`... keep name inference by evaluating the class as a keyed property.
    const key = JSON.stringify(name);
    s.prependRight(cls.start, `${helper}({ ${key}: `);
    s.appendLeft(cls.end, ` }[${key}], ${args})`);
  };

  const walk = (node: AstNode) => {
    let pushed = 0;
    const push = (scope: Scope) => {
      scopes.push(scope);
      pushed++;
    };
    switch (node.type) {
      case 'Program': {
        const scope: Scope = new Map();
        collect(scope, node.body);
        hoistVars(scope, node.body);
        push(scope);
        break;
      }
      case 'BlockStatement':
        push(new Map());
        collect(scopes[scopes.length - 1], node.body);
        break;
      case 'StaticBlock':
      case 'TSModuleBlock': {
        const scope: Scope = new Map();
        collect(scope, node.body);
        hoistVars(scope, node.body);
        push(scope);
        break;
      }
      case 'SwitchStatement': {
        const scope: Scope = new Map();
        node.cases.forEach((c: AstNode) => collect(scope, c.consequent));
        push(scope);
        break;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const scope: Scope = new Map();
        collect(scope, [node.init ?? node.left].filter((n) => n?.type === 'VariableDeclaration'));
        push(scope);
        break;
      }
      case 'CatchClause': {
        const scope: Scope = new Map();
        declarePattern(scope, node.param);
        push(scope);
        break;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const scope = typeParamScope(node.typeParameters);
        node.params.forEach((p: AstNode) => declarePattern(scope, p));
        if (node.type === 'FunctionExpression' && node.id) bind(scope, node.id.name, { value: 'other' });
        if (node.body?.type === 'BlockStatement') hoistVars(scope, node.body.body);
        push(scope);
        break;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        // Class type params shadow outer bindings for the whole class (constructor signature, nested classes).
        const scope = typeParamScope(node.typeParameters);
        // A named class expression's own name only exists inside it; the helper call is emitted outside.
        if (node.type === 'ClassExpression' && node.id) bind(scope, node.id.name, { type: 'alias' });
        push(scope);
        emitFor(node);
        break;
      }
    }
    ancestors.push(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === 'string') walk(c);
      } else if (child && typeof child.type === 'string') {
        walk(child);
      }
    }
    ancestors.pop();
    scopes.length -= pushed;
  };

  walk(program);
  if (emitted === 0) return null;

  // Before the first non-directive statement: keeps a hashbang, directives and leading pragma comments in place.
  const first = program.body.find((stmt: AstNode) => !stmt.directive);
  s.prependLeft(first?.start ?? 0, `import { ${helper === DI_HELPER ? helper : `${DI_HELPER} as ${helper}`} } from ${JSON.stringify(helperId)};\n`);

  return {
    code: s.toString(),
    map: s.generateMap({ source: cleanId(id), file: cleanId(id), includeContent: true, hires: 'boundary' }),
  };
}
