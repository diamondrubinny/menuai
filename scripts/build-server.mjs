/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Bundles the API server (and CLI) into dist-server/ with every dependency inlined.
// The server reuses the editor's HTML exporter, which imports Vite-style `?raw` (text) and
// `?url` (font files) modules: this build teaches esbuild both, copying fonts to dist-server/fonts/.
// Usage: node scripts/build-server.mjs            one-off production build
//        node scripts/build-server.mjs --watch    rebuild + restart the server on change (development)
import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist-server';

/** @type {import('esbuild').Plugin} */
const viteImports = {
  name: 'vite-imports',
  setup(b) {
    b.onResolve({ filter: /\?(raw|url)$/ }, async (args) => {
      const [request, kind] = args.path.split('?');
      const resolved = await b.resolve(request, { kind: args.kind, resolveDir: args.resolveDir });
      if (resolved.errors.length) return { errors: resolved.errors };
      return kind === 'raw' ? { path: resolved.path, namespace: 'raw' } : { path: resolved.path };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

/** Restarts the server after each successful rebuild in watch mode. */
function runner() {
  let child;
  return {
    name: 'run-server',
    setup(b) {
      b.onEnd((result) => {
        if (result.errors.length) return;
        child?.kill('SIGTERM');
        child = spawn(process.execPath, ['--enable-source-maps', path.join(outdir, 'main.mjs')], { stdio: 'inherit' });
      });
    },
  };
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['server/src/main.ts', 'server/src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['pg-native'],
  sourcemap: true,
  outdir,
  outExtension: { '.js': '.mjs' },
  // `?url` font imports become files next to the bundle; the server reads them from disk.
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  jsx: 'automatic',
  legalComments: 'inline',
  logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: watch ? [viteImports, runner()] : [viteImports],
};

await rm(outdir, { recursive: true, force: true });
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching server sources…');
} else {
  await build(options);
}
