// Runtime check: constructor DI (parameter properties) x class fields, for Option A and Option B.
// Self-contained on purpose (one file, no imports) so scripts/check-s1-s2.mjs can compile it with
// SWC (sauf warmup.ts options) and with tsc (useDefineForClassFields true/false) and run each output.
// Prints one JSON line of results.

type Ctx = { params: { user: string } };
const ACTION = Symbol.for("laratype.action");
function action<C>(endpoint: string, handler: (ctx: C) => Promise<unknown>) {
  return Object.assign((ctx: C) => handler(ctx), { [ACTION]: endpoint });
}

class UserRepository {
  find(id: string) {
    return { id, name: "Ada" };
  }
}

// Option A: method on the prototype
class CtrlA {
  constructor(private readonly repo: UserRepository) {}
  async show({ params }: Ctx) {
    return this.repo.find(params.user);
  }
}

// Option B: property handler; `this.repo` is read lazily, when the handler runs
class CtrlB {
  constructor(private readonly repo: UserRepository) {}
  show = action("users.show", async ({ params }: Ctx) => this.repo.find(params.user));
}

// Option B pitfall: a field initializer that reads the injected dep EAGERLY
class CtrlBEager {
  constructor(private readonly repo: UserRepository) {}
  // tsc: TS2729 "Property 'repo' is used before its initialization" when useDefineForClassFields is on
  // @ts-ignore -- kept to observe the runtime behaviour of each emitter
  find = this.repo.find.bind(this.repo);
}

// Subclass with its own constructor + field override
class CtrlBChild extends CtrlB {
  constructor(repo: UserRepository, private readonly suffix: string) {
    super(repo);
  }
  override show = action("users.show", async ({ params }: Ctx) => ({ id: params.user, name: "child" + this.suffix }));
}

const ctx: Ctx = { params: { user: "1" } };
const repo = new UserRepository();

async function attempt(fn: () => unknown): Promise<string> {
  try {
    return JSON.stringify(await fn());
  } catch (e) {
    return "throws: " + (e as Error).message.split("\n")[0];
  }
}

const a = new CtrlA(repo);
const b = new CtrlB(repo);
const results = {
  "A: instance.show(ctx)": await attempt(() => a.show(ctx)),
  "A: detached show(ctx)": await attempt(() => {
    const { show } = a;
    return show(ctx);
  }),
  "A: handler on prototype": Object.getOwnPropertyNames(CtrlA.prototype).includes("show"),
  "B: instance.show(ctx)": await attempt(() => b.show(ctx)),
  "B: detached show(ctx)": await attempt(() => {
    const { show } = b;
    return show(ctx);
  }),
  "B: handler on prototype": Object.getOwnPropertyNames(CtrlB.prototype).includes("show"),
  "B: endpoint readable without instance": "no (own field; needs an instance or static analysis)",
  "B eager field reads this.repo": await attempt(() => new CtrlBEager(repo).find("1")),
  "B child override + own ctor dep": await attempt(() => new CtrlBChild(repo, "!").show(ctx)),
  "B: own field order": Object.keys(b).join(","),
};
console.log(JSON.stringify(results));
export {};
