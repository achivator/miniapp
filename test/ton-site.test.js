// achivator.ton, the TON Site, redirects to the Mini App (lib/ton-site.js,
// used by src/middleware.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// lib/ton-site.js is an ES module without imports (see locale.test.js).
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ton-site.js'), 'utf8').replace(/^export /gm, '');
const { isTonSiteHost, tonSiteTarget, MINI_APP_URL } = vm.runInNewContext(
    `${source}\n({ isTonSiteHost, tonSiteTarget, MINI_APP_URL });`,
);

const target = (query) => tonSiteTarget(new URLSearchParams(query));

test('only the achivator.ton host is the TON Site', () => {
    assert.equal(isTonSiteHost('achivator.ton'), true);
    assert.equal(isTonSiteHost('Achivator.TON'), true);
    assert.equal(isTonSiteHost('achivator.ton:80'), true);
    assert.equal(isTonSiteHost('achivator.cc'), false);
    assert.equal(isTonSiteHost('sub.achivator.ton'), false);
    assert.equal(isTonSiteHost('achivator.ton.evil.com'), false);
    assert.equal(isTonSiteHost(null), false);
});

test('the redirect goes to the Mini App, with a valid startapp only', () => {
    assert.equal(MINI_APP_URL, 'https://t.me/achivator_bot/app');
    assert.equal(target(''), MINI_APP_URL);
    assert.equal(target('lang=ru'), MINI_APP_URL);
    assert.equal(target('startapp=chat_-100123'), `${MINI_APP_URL}?startapp=chat_-100123`);
    assert.equal(target('startapp='), MINI_APP_URL);
    assert.equal(target('startapp=a%26b%3Dc'), MINI_APP_URL);
    assert.equal(target('startapp=x%0d%0aSet-Cookie:a'), MINI_APP_URL);
    assert.equal(target(`startapp=${'a'.repeat(513)}`), MINI_APP_URL);
});
