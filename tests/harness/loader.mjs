/**
 * tests/harness/loader.mjs — lets `node --test` run the application's own TypeScript.
 *
 * Four jobs and nothing else: resolve the `@/…` alias that normally belongs to Vite,
 * fill in the extension a bundler-style import leaves off, swap the one module that
 * would build a live Supabase client for a stand-in the tests control, and compile the
 * JSX that Node cannot read. Everything else — the store, the calculations, the very nav
 * map the permission tests assert against — is the file the application ships, so a
 * passing test is a statement about production code and not about a copy of it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = path.join(ROOT, 'src');

/** The real client module and its replacement. */
const SUPABASE_REAL = pathToFileURL(path.join(SRC, 'lib', 'supabase.ts')).href;
const SUPABASE_STUB = pathToFileURL(path.join(ROOT, 'tests', 'harness', 'supabase-stub.mjs')).href;

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
const INDEXES = ['index.ts', 'index.tsx', 'index.mjs', 'index.js'];

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

/** A path as the app writes it (`./calc`, `@/lib/format`) → the file on disk, or null. */
function resolveFile(base) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  for (const index of INDEXES) {
    const p = path.join(base, index);
    if (isFile(p)) return p;
  }
  return null;
}

function asHref(file) {
  const href = pathToFileURL(file).href;
  return href === SUPABASE_REAL ? SUPABASE_STUB : href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const file = resolveFile(path.join(SRC, specifier.slice(2)));
    if (file) return { url: asHref(file), shortCircuit: true };
    throw new Error(`[tests] '@/…' import '${specifier}' matches no file under src/`);
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const dir = fileURLToPath(new URL('.', context.parentURL));
    const file = resolveFile(path.resolve(dir, specifier));
    // An import that already carries its extension resolves above; this branch is the
    // extensionless one Vite allows. Unknown specifiers fall through to Node unchanged.
    if (file) return { url: asHref(file), shortCircuit: true };
  }

  const result = await nextResolve(specifier, context);
  if (result.url === SUPABASE_REAL) return { ...result, url: SUPABASE_STUB };
  return result;
}

/**
 * Node reads a `.ts` file by stripping its types, but it has no answer for JSX — and the
 * navigation map in `components/layout/nav.tsx` is exactly the list the permission tests
 * check a role against. Compiling it here keeps that map the app's own: the rule is Vite's
 * (`react-jsx`, i.e. the automatic runtime), applied to the same source on disk.
 */
export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
  const file = fileURLToPath(url);
  const { code } = await transform(readFileSync(file, 'utf8'), {
    loader: 'tsx', format: 'esm', jsx: 'automatic', target: 'node20', sourcefile: file,
  });
  return { format: 'module', source: code, shortCircuit: true };
}
