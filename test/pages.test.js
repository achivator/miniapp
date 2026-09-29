const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isPage } = require('../src/lib/pages');

const APP = path.join(__dirname, '..', 'src', 'app');

// URL of a page.js file with sample values for its dynamic segments; null
// for the catch-alls that render the 404.
function samplePath(file) {
    const segments = path.relative(APP, path.dirname(file)).split(path.sep).filter(Boolean);
    if (segments.some((s) => s.startsWith('[...'))) return null;
    const url = segments
        .filter((s) => !(s.startsWith('(') && s.endsWith(')'))) // route groups
        .map((s) => (s.startsWith('[') ? 'sample-1' : s));
    return '/' + url.join('/');
}

function pageFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name.startsWith('_') ? [] : pageFiles(full);
        return entry.name === 'page.js' ? [full] : [];
    });
}

test('every page route is known to the 404 middleware', () => {
    const routes = pageFiles(APP).map(samplePath).filter((p) => p !== null);
    assert.ok(routes.length >= 10, `found only ${routes.length} page routes`);
    for (const route of routes) assert.ok(isPage(route), `${route} is missing from src/lib/pages.js`);
});

test('unknown paths are not pages', () => {
    for (const p of ['/foo', '/foo/bar', '/ru/nope', '/en/help/x', '/deposit/1/x/y', '/achievement', '/deposit']) {
        assert.equal(isPage(p), false, p);
    }
});
