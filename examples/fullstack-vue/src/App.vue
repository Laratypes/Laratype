<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "./api";
import type { User } from "./api";

/** A declared error, or the catch-all the client uses for a network failure or an undeclared status. */
interface ShownError {
  code: string;
  message: string;
}

const users = ref<User[]>([]);
const selected = ref<User | null>(null);
const error = ref<ShownError | null>(null);
const message = ref("");
const saving = ref(false);
const lookupId = ref("999");
const form = ref({ name: "Ada Lovelace", email: "ada@example.com" });

function showUnexpected(status: number): void {
  error.value = { code: "UNEXPECTED", message: `The request failed with status ${status}.` };
}

/** The 422 body is typed by the contract: a dot path to its messages (docs/v1/contract.md › Error catalog). */
function formatValidationErrors(errors: Record<string, string[]>): string {
  return Object.entries(errors)
    .map(([field, messages]) => `${field || "body"}: ${messages.join(", ")}`)
    .join("; ");
}

async function load(): Promise<void> {
  error.value = null;
  const result = await api.users.index();
  if (result.ok) {
    users.value = result.data.data;
    return;
  }
  showUnexpected(result.status);
}

async function showUser(id: number): Promise<void> {
  error.value = null;
  message.value = "";
  const result = await api.users.show({ params: { id } });
  if (result.ok) {
    selected.value = result.data;
    return;
  }
  if (result.code === "NOT_FOUND") {
    error.value = { code: result.code, message: result.error.message };
    return;
  }
  showUnexpected(result.status);
}

function showById(): void {
  const id = Number(lookupId.value);
  if (Number.isInteger(id) && id > 0) void showUser(id);
}

async function createUser(): Promise<void> {
  saving.value = true;
  error.value = null;
  message.value = "";
  const result = await api.users.store({ body: { name: form.value.name, email: form.value.email } });
  saving.value = false;
  if (result.ok) {
    message.value = `Created #${result.data.id}: ${result.data.name} <${result.data.email}>.`;
    form.value = { name: "", email: "" };
    await load();
    return;
  }
  if (result.code === "VALIDATION_ERROR") {
    error.value = { code: result.code, message: formatValidationErrors(result.error.errors) };
    return;
  }
  showUnexpected(result.status);
}

onMounted(load);
</script>

<template>
  <main>
    <header>
      <h1>Laratype fullstack Vue</h1>
      <p>
        The users of <code>examples/basic</code>, called through <code>@laratype/client</code> and typed by its
        contracts.
      </p>
    </header>

    <p v-if="message" class="success" role="status">{{ message }}</p>
    <p v-if="error" class="failure" role="alert">
      <strong>{{ error.code }}</strong>
      <span>{{ error.message }}</span>
    </p>

    <section>
      <h2>Users</h2>
      <button type="button" @click="load">Reload</button>
      <ul>
        <li v-for="user in users" :key="user.id">
          <button type="button" @click="showUser(user.id)">
            #{{ user.id }} {{ user.name }} &lt;{{ user.email }}&gt;
          </button>
        </li>
      </ul>
      <p v-if="selected" class="selected">
        <strong>#{{ selected.id }} {{ selected.name }}</strong>
        <span>{{ selected.email }}</span>
      </p>
    </section>

    <section>
      <h2>Show one</h2>
      <input v-model="lookupId" inputmode="numeric" aria-label="User id" />
      <button type="button" @click="showById">Show</button>
      <p class="hint">Try <code>999</code> for the declared 404 (<code>NOT_FOUND</code>).</p>
    </section>

    <section>
      <h2>Create one</h2>
      <form novalidate @submit.prevent="createUser">
        <input v-model="form.name" placeholder="Name" aria-label="Name" />
        <input v-model="form.email" placeholder="Email" aria-label="Email" />
        <button type="submit" :disabled="saving">{{ saving ? "Creating…" : "Create" }}</button>
      </form>
      <p class="hint">
        Leave the name empty or type an invalid email for the declared 422
        (<code>VALIDATION_ERROR</code>).
      </p>
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

body {
  margin: 0;
}

main {
  display: grid;
  gap: 1.5rem;
  margin: 0 auto;
  max-width: 42rem;
  padding: 2rem 1rem;
}

header h1 {
  margin-bottom: 0.25rem;
}

section {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 0.5rem;
  padding: 1rem;
}

section h2 {
  margin-top: 0;
}

ul {
  list-style: none;
  padding: 0;
}

li + li {
  margin-top: 0.25rem;
}

button {
  cursor: pointer;
}

li button {
  background: none;
  border: 0;
  padding: 0;
  text-decoration: underline;
}

.selected {
  display: grid;
  gap: 0.25rem;
}

input {
  margin-right: 0.5rem;
}

.success,
.failure {
  border-radius: 0.5rem;
  margin: 0;
  padding: 0.75rem 1rem;
}

.success {
  background: color-mix(in srgb, green 15%, transparent);
}

.failure {
  background: color-mix(in srgb, red 15%, transparent);
  display: grid;
  gap: 0.25rem;
}

.hint {
  opacity: 0.75;
}

form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
</style>
