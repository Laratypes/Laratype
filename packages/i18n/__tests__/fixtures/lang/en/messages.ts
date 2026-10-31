import { defineLang } from "../../../../src";

/** A reference translation file for the type tests; never discovered by the app manifest. */
export default defineLang({
  greeting: "Hello {name}",
  apples: { one: "{count} apple", other: "{count} apples" },
  nested: { farewell: "Bye {name}" },
  plain: "No params",
});
