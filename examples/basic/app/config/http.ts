import { defineConfig } from "@laratype/core";

// Request body caps in bytes (docs/v1/http.md › Default body limit, H44 #341). These are the built-in defaults: a
// JSON or urlencoded body over 1 MiB, or a multipart body over 10 MiB, answers 413. Raise a cap for a route that
// needs a larger body; `false` disables one, and `bodyLimit: false` disables all three.
export default defineConfig({
  bodyLimit: {
    json: 1_048_576,
    form: 1_048_576,
    multipart: 10_485_760,
  },
});
