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
const { LOCALE_SCRIPT, legacyAnchor, takeReferrer } = vm.runInNewContext(
    `${source}\n({ LOCALE_SCRIPT, legacyAnchor, takeReferrer });`,
);

// A sessionStorage stand-in.
function memoryStorage() {
    const items = new Map();
    return {
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: (key) => items.delete(key),
    };
}

function run(url, { language = 'en-US', saved = null, launch, referrer = '', session = memoryStorage() } = {}) {
    const { pathname, search, hash } = new URL(url, 'https://achivator.cc');
    const html = { dataset: launch ? { launch } : {} };
    let replaced = null;
    vm.runInNewContext(LOCALE_SCRIPT, {
        document: { documentElement: html, referrer },
        location: { pathname, search, hash, replace: (to) => (replaced = to) },
        navigator: { language },
        localStorage: { getItem: () => saved },
        sessionStorage: session,
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

test('the redirect keeps the referrer for the localized page, once', () => {
    const session = memoryStorage();
    run('/?utm_source=x', { language: 'ru', referrer: 'https://www.google.com/', session });
    assert.equal(takeReferrer(session, '/ru'), 'https://www.google.com/');
    assert.equal(takeReferrer(session, '/ru'), null);

    run('/help', { referrer: '', session });
    assert.equal(takeReferrer(session, '/en/help'), '');
});

test('a kept referrer is not given to another page', () => {
    const session = memoryStorage();
    run('/', { language: 'ru', referrer: 'https://t.co/x', session });
    assert.equal(takeReferrer(session, '/en'), null);
    assert.equal(takeReferrer(session, '/ru'), null);
    assert.equal(takeReferrer(memoryStorage(), '/ru'), null);
});

test('no redirect, nothing kept', () => {
    const session = memoryStorage();
    run('/ru', { referrer: 'https://www.google.com/', session });
    run('/#tgWebAppData=abc', { launch: 'telegram', referrer: 'https://x.y/', session });
    assert.equal(takeReferrer(session, '/ru'), null);
});

test('legacyAnchor strips only the locale prefix', () => {
    assert.equal(legacyAnchor('#ru-pricing'), '#pricing');
    assert.equal(legacyAnchor('#en-pool-admin'), '#pool-admin');
    assert.equal(legacyAnchor('#pool-admin'), '#pool-admin');
    assert.equal(legacyAnchor('#tgWebAppData=ru-x'), '#tgWebAppData=ru-x');
    assert.equal(legacyAnchor(''), '');
});
