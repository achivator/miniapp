// ESM resolve hook for the integration tests: lets Node import the Next.js
// route modules as they are, resolving the "@/..." alias from jsconfig.json
// to src/ (and adding the ".js" Next.js lets imports leave out). Route files
// use ESM syntax in a package without "type": "module", so they are loaded
// as modules explicitly; everything under src/lib stays CommonJS.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);
const APP = new URL('app/', SRC).href;

function aliasTarget(specifier) {
    const base = new URL(specifier.slice(2), SRC);
    for (const candidate of [base.href, `${base.href}.js`, `${base.href}/index.js`]) {
        const path = fileURLToPath(candidate);
        if (existsSync(path) && !path.endsWith('/') && /\.[cm]?js$/.test(path)) return pathToFileURL(path).href;
    }
    return null;
}

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
        const target = aliasTarget(specifier);
        if (target) return nextResolve(target, context);
    }
    const result = await nextResolve(specifier, context);
    if (result.url.startsWith(APP) && result.url.endsWith('.js')) return { ...result, format: 'module' };
    return result;
}
