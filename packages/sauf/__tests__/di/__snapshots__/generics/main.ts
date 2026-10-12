import { __laratype_deps } from "virtual:laratype/di";
import { Container, assertEqual } from 'virtual:laratype/di';

class User {}
class Post {}
export class Repo<T> {
  model?: T;
}

export class Feed {
  constructor(public users: Repo<User>, public posts: Repo<Post>) {}
}
__laratype_deps(Feed, [() => Repo, () => Repo], { params: ["users","posts"] });

const feed = new Container().resolve<Feed>(Feed);
assertEqual(feed.users instanceof Repo, true, 'Repo<User> -> Repo');
// Erased generics collide: both params get the same Repo singleton (needs @Inject tokens to separate).
assertEqual(feed.users === feed.posts, true, 'Repo<User> and Repo<Post> share one token');
void User;
void Post;
