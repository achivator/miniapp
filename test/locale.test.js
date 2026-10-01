// The inline script that sends "/" and "/help" on to /ru… or /en… before the
// first paint (LOCALE_SCRIPT in lib/locale.js), run against fake browser
// globals.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// lib/locale.js is an ES module without imports: run as a script with its
// `export`s dropped (importing it would make node warn about the module type).
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'locale.js'), 'utf8').replace(/^export /gm, '');
const { LOCALE_SCRIPT, legacyAnchor } = vm.runInNewContext(`${source}\n({ LOCALE_SCRIPT, legacyAnchor });`);

function run(url, { language = 'en-US', saved = null, launch } = {}) {
    const { pathname, search, hash } = new URL(url, 'https://achivator.cc');
    const html = { dataset: launch ? { launch } : {} };
    let replaced = null;
    vm.runInNewContext(LOCALE_SCRIPT, {
        document: { documentElement: html },
        location: { pathname, search, hash, replace: (to) => (replaced = to) },
        navigator: { language },
        localStorage: { getItem: () => saved },
        sessionStorage: { getItem: () => null },
        URLSearchParams,
    });
    return { lang: html.dataset.lang, replaced };
}

test('"/" goes to the browser language, keeping query and anchor', () => {
    assert.deepEqual(run('/', { language: 'ru-RU' }), { lang: 'ru', replaced: '/ru' });
    assert.deepEqual(run('/?utm=x#faq'), { lang: 'en', replaced: '/en?utm=x#faq' });
    assert.deepEqual(run('/help?lang=ru'), { lang: 'ru', replaced: '/ru/help' });
});

test('old locale-prefixed anchors become the page\'s own', () => {
    assert.equal((run('/#ru-pricing', { language: 'ru' })).replaced, '/ru#pricing');
    assert.equal((run('/help#en-wallet', { saved: 'en' })).replaced, '/en/help#wallet');
});

test('a Telegram launch of "/" stays', () => {
    assert.deepEqual(run('/#tgWebAppData=abc', { launch: 'telegram', language: 'ru' }), { lang: 'ru', replaced: null });
});

test('legacyAnchor strips only the locale prefix', () => {
    assert.equal(legacyAnchor('#ru-pricing'), '#pricing');
    assert.equal(legacyAnchor('#en-pool-admin'), '#pool-admin');
    assert.equal(legacyAnchor('#pool-admin'), '#pool-admin');
    assert.equal(legacyAnchor('#tgWebAppData=ru-x'), '#tgWebAppData=ru-x');
    assert.equal(legacyAnchor(''), '');
});
