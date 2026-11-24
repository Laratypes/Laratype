import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";
import App from "./App.vue";

// The app's one QueryClient; the plugin provides it to `useQuery` and `useMutation` in every component.
const queryClient = new QueryClient();

createApp(App).use(VueQueryPlugin, { queryClient }).mount("#app");
