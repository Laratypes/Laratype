// Option (a): value import of the FE API (contracts only) + createClient. Bundle entry for the size table.
import { appApi } from "@app/contracts";
import { createClient, validateBody } from "../../client/create-client";

export const api = createClient(appApi, { baseUrl: "https://api.example.com" });

export async function demo(form: { name: string; email: string }) {
  // same schema as the server, run in the browser
  const checked = await validateBody(appApi.users.store, form);
  if (checked.issues) return checked.issues.map((i) => i.message);

  const created = await api.users.store({ body: form });
  if (created.ok) return created.data.email;
  if (created.status === 422 && !("unexpected" in created)) return Object.keys(created.error.errors);

  const list = await api.users.index({ query: { page: 2 } });
  const shown = await api.users.show({ params: { user: "1" } });
  return [list.ok && list.data.length, shown.ok && shown.data.name];
}
