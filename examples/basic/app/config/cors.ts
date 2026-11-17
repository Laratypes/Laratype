import { defineConfig } from "@laratype/core";
import type { CorsConfig } from "@laratype/http";

// CORS for a separate frontend (docs/v1/http.md › CORS, H15 #164). The API answers the preflight and adds the headers
// to every /api response; a browser page served from another origin is refused unless it is listed here. Add the
// deployed frontend's origin in production; a wildcard cannot pair with `credentials: true`.
export default defineConfig<CorsConfig>({
  paths: ["/api/*"],
  origin: ["http://localhost:5173"],
  allowHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  maxAge: 600,
  credentials: true,
});
