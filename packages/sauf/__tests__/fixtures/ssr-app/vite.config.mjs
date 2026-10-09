// Records every workspace-package module id Vite SSR loads, so the test can
// check that `sauf dev` rewrites @laratype/* from dist to src.
export default {
  plugins: [
    {
      name: 'ssr-probe:record-ids',
      load(id) {
        const normalized = id.split('\\').join('/');
        const match = normalized.match(/\/(packages\/[^/]+\/(?:src|dist)\/.*)$/);
        if (match) {
          (globalThis.__ssr_probe_loaded_ids ??= []).push(match[1]);
        }
        return null;
      },
    },
  ],
};
