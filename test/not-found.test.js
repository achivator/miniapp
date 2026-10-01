// The styled 404: app/global-not-found.js for unknown URLs, and the
// middleware's localized 404 under /ru/ and /en/, which lets through only
// the localized pages listed in PAGES (lib/locale.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'src', 'app');

// lib/locale.js is an ES module without imports (see locale.test.js).
const source = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'locale.js'), 'utf8').replace(/^export /gm, '');
const { LOCALES, PAGES } = vm.runInNewContext(`${source}\n({ LOCALES, PAGES });`);

function pageFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return pageFiles(full);
        return entry.name === 'page.js' ? [full] : [];
    });
}

test('every localized page is in PAGES, and every PAGES entry exists in each locale', () => {
    for (const locale of LOCALES) {
        const suffixes = pageFiles(path.join(APP, locale))
            .map((file) => path.relative(path.join(APP, locale), path.dirname(file)).split(path.sep).filter(Boolean))
            .filter((segments) => !segments.some((s) => s.startsWith('[...'))) // the 404 catch-all
            .map((segments) => segments.map((s) => `/${s}`).join(''));
        assert.deepEqual([...suffixes].sort(), [...PAGES].sort(), `pages under app/${locale} vs PAGES in lib/locale.js`);
    }
});

test('global-not-found.js is enabled', async () => {
    // Next 15 ignores the file without the flag and serves its bare default.
    assert.ok(fs.existsSync(path.join(APP, 'global-not-found.js')));
    const { default: config } = await import(path.join(ROOT, 'next.config.mjs'));
    assert.equal(config.experimental?.globalNotFound, true);
});
