// Type tests for typed policies and gates (A3 #121): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from "vitest";
import { Model } from "@laratype/database";
import { Authenticated, ForbiddenException, Gate, policyAllows, policyAuthorize, policyCheck } from "../src";
import type {
  AnyPolicy,
  CheckPolicy,
  GateAbility,
  HasPolicy,
  ModelPolicy,
  PolicyAbility,
  PolicyArgs,
  PolicyBrand,
  PolicySubject,
  SubjectAbility,
  SubjectArgs,
  SubjectParam,
} from "../src";

class User extends Model {
  email!: string
}

/** A policy class; a v1 policy needs no base class. */
class PostPolicy {
  before(_user: User, _ability: string): boolean | null {
    return null;
  }
  viewAny(_user: User): boolean {
    return true;
  }
  update(user: User, post: Post): boolean {
    return user !== null && post !== null;
  }
  delete(_user: User, _post: Post): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** A policy with one argument after the subject, to check the rest-argument tuple. */
class SharingPolicy {
  share(user: User, _post: SharingPost, target: User): boolean {
    return user === target;
  }
}

class OtherPolicy {
  update(): boolean {
    return true;
  }
}

// The type half of Gate.policy(Model, Policy): the model type declares its policy.
class PostModel extends Model {
  title!: string
}
/** An intersection, as `interface Post extends HasPolicy<PostPolicy> {}` gives a model: the brand adds nothing at runtime. */
type Post = PostModel & HasPolicy<PostPolicy>
declare const PostClass: new () => Post

class SharingPostModel extends Model {}
type SharingPost = SharingPostModel & HasPolicy<SharingPolicy>

/** A model with no declared policy: the checks must refuse it. */
class PlainModel extends Model {}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

const user = new User();
declare const post: Post;
declare const sharingPost: SharingPost;
const authenticated = new Authenticated<User>(user, undefined as never);

describe("policies: abilities and arguments (A3 #121)", () => {
  test("the brand is a symbol key, never a string key of the model", () => {
    expectTypeOf<Extract<keyof Post, symbol>>().toEqualTypeOf<PolicyBrand>();
    expectTypeOf<Extract<keyof Post, string>>().toEqualTypeOf<Extract<keyof Model, string> | "title">();
    expectTypeOf<Extract<keyof PlainModel, symbol>>().toEqualTypeOf<never>();
    expectTypeOf<ModelPolicy<Post>>().toEqualTypeOf<PostPolicy>();
    expectTypeOf<ModelPolicy<PlainModel>>().toEqualTypeOf<never>();
    expectTypeOf<PolicyAbility<PostPolicy>>().toEqualTypeOf<"viewAny" | "update" | "delete">();
    expectTypeOf<PolicyArgs<PostPolicy, "update">>().toEqualTypeOf<[]>();
    expectTypeOf<PolicyArgs<SharingPolicy, "share">>().toEqualTypeOf<[target: User]>();
    expectTypeOf<PolicySubject<PostPolicy, "update">>().toEqualTypeOf<Post>();
    expectTypeOf<PolicySubject<PostPolicy, "viewAny">>().toEqualTypeOf<never>();
    expectTypeOf<PolicySubject<SharingPolicy, "share">>().toEqualTypeOf<SharingPost>();
    expectTypeOf<SubjectAbility<Post>>().toEqualTypeOf<"viewAny" | "update" | "delete">();
    expectTypeOf<SubjectAbility<PlainModel>>().toEqualTypeOf<string>();
    expectTypeOf<SubjectArgs<Post, "delete">>().toEqualTypeOf<[]>();
    expectTypeOf<SubjectArgs<PlainModel, "anything">>().toEqualTypeOf<unknown[]>();
    // The subject parameter constrains the instance, but a class stays valid for an ability with no subject
    expectTypeOf<SubjectParam<Post, "update">>().toEqualTypeOf<Post>();
    expectTypeOf<SubjectParam<Post, "viewAny">>().toEqualTypeOf<unknown>();
    expectTypeOf<SubjectParam<PlainModel, "anything">>().toEqualTypeOf<unknown>();
  });

  test("Gate.allows, denies and authorize are typed by the subject's policy", () => {
    typeOnly(() => {
      expectTypeOf(Gate.allows(user, "update", post)).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(Gate.allows(user, "viewAny", post)).toEqualTypeOf<Promise<boolean>>();
      // A model class is a subject too: `Gate.allows(user, "viewAny", Post)`
      expectTypeOf(Gate.allows(user, "viewAny", PostClass)).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(Gate.denies(user, "delete", post)).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(Gate.authorize(user, "update", post)).toEqualTypeOf<Promise<void>>();
      expectTypeOf(Gate.policy(PostClass, PostPolicy)).toEqualTypeOf<void>();
    });
  });

  test("Authenticated.can and cannot carry the same types", () => {
    typeOnly(() => {
      expectTypeOf(authenticated.can("update", post)).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(authenticated.cannot("viewAny", post)).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(authenticated.can("share", sharingPost, user)).toEqualTypeOf<Promise<boolean>>();
    });
  });

  test("negatives", () => {
    typeOnly(() => {
      // @ts-expect-error an unknown ability is not an ability of the subject's policy
      Gate.allows(user, "nope", post);
      // @ts-expect-error the ability needs its argument: share(user, post, target)
      Gate.allows(user, "share", sharingPost);
      // @ts-expect-error too many arguments
      Gate.allows(user, "update", post, post, post);
      // @ts-expect-error a wrong argument type
      Gate.allows(user, "update", post, 1);
      // @ts-expect-error a subject with no declared policy
      Gate.allows(user, "update", new PlainModel());
      // @ts-expect-error update(user, post) needs a Post instance, not the model class
      Gate.allows(user, "update", PostClass);
      // @ts-expect-error a model with another policy: the brand must match
      Gate.policy(PostClass, OtherPolicy);
      // @ts-expect-error an ability the policy does not have
      authenticated.can("nope", post);
      // @ts-expect-error update(user, post) needs a Post instance here too
      authenticated.can("update", PostClass);
    });
  });
});

describe("policies: bare generic names mean any policy (A3 #121)", () => {
  test("every public generic policy type has a default", () => {
    typeOnly(() => {
      expectTypeOf<AnyPolicy>().toEqualTypeOf<{
        [ability: string]: (user: any, subject: unknown) => any;
      }>();
      expectTypeOf<PolicyAbility>().toEqualTypeOf<string>();
      expectTypeOf<PolicyAbility<AnyPolicy>>().toEqualTypeOf<string>();
      expectTypeOf<PolicyArgs>().toEqualTypeOf<[]>();
      expectTypeOf<PolicySubject>().toEqualTypeOf<unknown>();
      expectTypeOf<HasPolicy>().toEqualTypeOf<HasPolicy<AnyPolicy>>();
      expectTypeOf<ModelPolicy>().toEqualTypeOf<AnyPolicy>();
      expectTypeOf<SubjectAbility>().toEqualTypeOf<string>();
      expectTypeOf<SubjectArgs>().toEqualTypeOf<[]>();
      expectTypeOf<SubjectParam>().toEqualTypeOf<unknown>();
      expectTypeOf<CheckPolicy>().toEqualTypeOf<unknown>();
    });
  });
});

describe("gates: typed values (A3 #121)", () => {
  const UpdateUserGate = Gate.define("update-user", (user: User, target: User) => user === target);
  const SyncGate = Gate.define("sync", (_user: User) => true);

  test("Gate.define returns a typed value and Gate.allows takes it", () => {
    typeOnly(() => {
      expectTypeOf(UpdateUserGate).toEqualTypeOf<GateAbility<[target: User]>>();
      expectTypeOf(Gate.allows(user, UpdateUserGate, new User())).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(Gate.denies(user, UpdateUserGate, new User())).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(Gate.authorize(user, UpdateUserGate, new User())).toEqualTypeOf<Promise<void>>();
      // A gate with no argument after the user
      expectTypeOf(Gate.allows(user, SyncGate)).toEqualTypeOf<Promise<boolean>>();
    });
  });

  test("negatives", () => {
    typeOnly(() => {
      // @ts-expect-error the gate takes a User
      Gate.allows(user, UpdateUserGate, post);
      // @ts-expect-error the gate takes one argument
      Gate.allows(user, UpdateUserGate);
      // @ts-expect-error a gate with no argument takes none
      Gate.allows(user, SyncGate, user);
    });
  });
});

describe("policy checks (A3 #121)", () => {
  test("policyCheck is tri-state, policyAllows and policyAuthorize are boolean and 403", () => {
    typeOnly(() => {
      expectTypeOf(policyCheck(new PostPolicy(), user, "update", post)).toEqualTypeOf<Promise<boolean | null>>();
      expectTypeOf(policyAllows(new PostPolicy(), user, "update", post)).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(policyAuthorize(new PostPolicy(), user, "update", post)).toEqualTypeOf<Promise<void>>();
      expectTypeOf(new ForbiddenException()).toEqualTypeOf<ForbiddenException>();
    });
  });
});
