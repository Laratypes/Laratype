---
"@laratype/support": patch
---

Never load a template .env file (.env.example, .env.sample, .env.template, .env.dist) and prefer .env.<NODE_ENV> when NODE_ENV is one plain name; a project with only templates loads nothing.
