const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isFile, isPage } = require('../src/lib/pages');

const APP = path.join(__dirname, '..', 'src', 'app');
const PUBLIC = path.join(__dirname, '..', 'public');

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

function allFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? allFiles(full) : [full];
    });
}

// URL of a metadata file or route at the top of src/app (see Next's file
// conventions); null for anything else there.
function metadataPath(name) {
    const { name: base, ext } = path.parse(name);
    if (name === 'favicon.ico') return '/favicon.ico';
    if (base === 'robots') return '/robots.txt';
    if (base === 'sitemap') return '/sitemap.xml';
    if (base === 'manifest') return ext === '.json' || ext === '.webmanifest' ? `/${name}` : '/manifest.webmanifest';
    if (/^(icon|apple-icon|opengraph-image|twitter-image)\d*$/.test(base)) return `/${name}`;
    return null;
}

test('every public file and metadata route is known to the 404 middleware', () => {
    const files = allFiles(PUBLIC).map((file) => '/' + path.relative(PUBLIC, file).split(path.sep).map(encodeURIComponent).join('/'));
    const metadata = fs.readdirSync(APP).map(metadataPath).filter(Boolean);
    assert.ok(metadata.length >= 3, `found only ${metadata.length} metadata routes`);
    for (const file of [...files, ...metadata]) assert.ok(isFile(file), `${file} is missing from FILES in src/lib/pages.js`);
});

test('unknown dotted paths are not files', () => {
    for (const p of ['/foo.txt', '/wp-login.php', '/.env', '/ru/foo.txt', '/robots.txt.bak', '/favicon.ico/x', '/help.html']) {
        assert.equal(isFile(p), false, p);
        assert.equal(isPage(p), false, p);
    }
});
