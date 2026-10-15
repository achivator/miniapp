// Achievement SBTs of a protocol v3 AchievementRegistry: the privacy tags,
// template keys and item indexes (lib/ton/achievement-tags.js), the v3
// voucher layouts (lib/ton/vouchers.js) and the ACHIEVEMENT_TEMPLATES
// parsing (lib/ton/config.js). The byte-for-byte match against the
// compiled contracts lives in ton-contracts/tests/AchievementRegistry.spec.ts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Address, beginCell } = require('@ton/core');

const tags = require('../src/lib/ton/achievement-tags');
const vouchers = require('../src/lib/ton/vouchers');
const { OP, VOUCHER_TAG } = require('../src/lib/ton/constants');
const { templateFor } = require('../src/lib/ton/config');

const KEY_HEX = '0b'.repeat(32);
const KEY = Buffer.from(KEY_HEX, 'hex');
const ENV = { ACHIEVEMENT_TAG_KEY: KEY_HEX };
const hmac = (text) => BigInt('0x' + crypto.createHmac('sha256', KEY).update(text).digest('hex'));
const WALLET = new Address(0, Buffer.alloc(32, 6));

test('tags are HMAC-SHA256 of "user:<id>" / "chat:<id>" under ACHIEVEMENT_TAG_KEY', () => {
    const key = tags.tagKey(ENV);
    assert.deepEqual(key, KEY);
    assert.equal(tags.userTag(424242, key), hmac('user:424242'));
    assert.equal(tags.userTag(424242n, key), hmac('user:424242'));
    assert.equal(tags.userTag('424242', key), hmac('user:424242'));
    assert.equal(tags.chatTag(-1001234567890, key), hmac('chat:-1001234567890'));
    assert.equal(tags.chatTag(-1001234567890n, key), hmac('chat:-1001234567890'));
    // a user and a chat with the same number get different tags
    assert.notEqual(tags.userTag(5, key), tags.chatTag(5, key));
    assert.ok(tags.userTag(1, key) < 2n ** 256n);
    // 0x-prefixed keys are fine too
    assert.deepEqual(tags.tagKey({ ACHIEVEMENT_TAG_KEY: '0x' + KEY_HEX }), KEY);
});

test('there are no tags without a 32-byte tag key (and BACKEND_SECRET is not a fallback)', () => {
    for (const env of [{}, { ACHIEVEMENT_TAG_KEY: '' }, { ACHIEVEMENT_TAG_KEY: 'ab' }, { ACHIEVEMENT_TAG_KEY: 'zz'.repeat(32) }]) {
        assert.throws(() => tags.tagKey({ ...env, BACKEND_SECRET: KEY_HEX }), /ACHIEVEMENT_TAG_KEY/);
        assert.equal(tags.hasTagKey(env), false);
    }
    assert.equal(tags.hasTagKey(ENV), true);
});

test('template keys and item indexes are cell hashes of two uint256', () => {
    const hash = (a, b) => BigInt('0x' + beginCell().storeUint(a, 256).storeUint(b, 256).endCell().hash().toString('hex'));
    assert.equal(tags.templateKeyOf(7n, 0xabcn), hash(7n, 0xabcn));
    assert.equal(tags.itemIndexOf(9n, 2n ** 255n), hash(9n, 2n ** 255n));
    assert.equal(tags.PLATFORM_CHAT_TAG, 0n);
    assert.equal(tags.toHex256(255n), '0x' + '0'.repeat(62) + 'ff');
});

test('the backend signs only ipfs:// and allowlisted https content URLs of 8-126 bytes', () => {
    const ok = [
        'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/x.json',
        'https://achivator.cc/metadata/items/v1/programmer.json',
    ];
    for (const url of ok) assert.equal(tags.assertAllowedContentUrl(url, {}), url);
    const bad = [
        'http://achivator.cc/metadata/x.json',
        'https://evil.example/metadata/x.json',
        'https://achivator.cc.evil.example/metadata/x.json',
        'https://achivator.cc/other/x.json',
        'https://achivator.cc/metadata/' + 'a'.repeat(127 - 30),
        'ipfs://',
        'ipfs://bafy x.json',
        'data:application/json,{}',
        '',
    ];
    for (const url of bad) assert.throws(() => tags.assertAllowedContentUrl(url, {}), undefined, url);
    // ACHIEVEMENT_CONTENT_PREFIXES adds https prefixes
    const env = { ACHIEVEMENT_CONTENT_PREFIXES: 'https://cdn.example/a/, http://plain.example/' };
    assert.equal(tags.assertAllowedContentUrl('https://cdn.example/a/x.json', env), 'https://cdn.example/a/x.json');
    assert.throws(() => tags.assertAllowedContentUrl('http://plain.example/x.json', env));
    // 126 bytes is the limit
    const max = 'https://achivator.cc/metadata/' + 'a'.repeat(126 - 30);
    assert.equal(Buffer.byteLength(max), 126);
    assert.equal(tags.assertAllowedContentUrl(max, {}), max);
});

test('a v3 mint voucher is uint256 templateKey, address, uint256 userTag, uint64 expiry', () => {
    const cell = vouchers.buildMintVoucherV3Cell({ templateKey: 2n ** 255n + 1n, recipient: WALLET, userTag: 3n, expiry: 99n });
    const s = cell.beginParse();
    assert.equal(s.loadUintBig(256), 2n ** 255n + 1n);
    assert.ok(s.loadAddress().equals(WALLET));
    assert.equal(s.loadUintBig(256), 3n);
    assert.equal(s.loadUintBig(64), 99n);
    s.endParse();
    assert.equal(cell.refs.length, 0);
});

test('a v3 register voucher binds chatTag, registrant, contentHash, expiry and the URL cell', () => {
    const url = 'https://achivator.cc/metadata/items/v1/santa.json';
    const cell = vouchers.buildRegisterVoucherCell({ chatTag: 5n, registrant: WALLET, contentHash: 6n, expiry: 7n, contentUrl: url });
    const s = cell.beginParse();
    assert.equal(s.loadUintBig(256), 5n);
    assert.ok(s.loadAddress().equals(WALLET));
    assert.equal(s.loadUintBig(256), 6n);
    assert.equal(s.loadUintBig(64), 7n);
    const u = s.loadRef().beginParse();
    s.endParse();
    assert.equal(u.remainingRefs, 0);
    assert.equal(u.loadBuffer(u.remainingBits / 8).toString(), url);
    assert.throws(() =>
        vouchers.buildRegisterVoucherCell({ chatTag: 5n, registrant: WALLET, contentHash: 6n, expiry: 7n, contentUrl: 'https://evil.example/x.json' }),
    );
});

test('register and mint bodies: opcode, ref(voucher), 512-bit signature', () => {
    const voucher = beginCell().storeUint(1, 8).endCell();
    const signature = Buffer.alloc(64, 1);
    for (const [build, op] of [
        [vouchers.buildRegisterBody, 0xac4e0001],
        [vouchers.buildMintBody, 0xf7b315f8],
    ]) {
        const s = build({ voucherCell: voucher, signature }).beginParse();
        assert.equal(s.loadUint(32), op);
        assert.ok(s.loadRef().equals(voucher));
        assert.deepEqual(s.loadBuffer(64), signature);
        s.endParse();
    }
    assert.equal(OP.RegisterTemplate, 0xac4e0001);
    assert.equal(OP.MintAchievement, 0xf7b315f8);
    // v3 keeps the voucher kinds; the layouts are told apart by the registry's version
    assert.equal(VOUCHER_TAG.Register, 0x52454731);
    assert.equal(VOUCHER_TAG.Mint, 0x4d4e5431);
});

test('the legacy (v2) mint voucher layout is unchanged', () => {
    const s = vouchers
        .buildMintVoucherCell({ templateId: 3, recipient: WALLET, tgUserId: -5n, nonce: 8n, expiry: 9n })
        .beginParse();
    assert.equal(s.loadUint(32), 3);
    assert.ok(s.loadAddress().equals(WALLET));
    assert.equal(s.loadIntBig(64), -5n);
    assert.equal(s.loadUintBig(64), 8n);
    assert.equal(s.loadUintBig(64), 9n);
    s.endParse();
});

test('ACHIEVEMENT_TEMPLATES: integers are v2 template ids, 0x hex strings are v3 template keys', () => {
    const saved = process.env.ACHIEVEMENT_TEMPLATES;
    try {
        const key = '0x' + 'ab'.repeat(32);
        process.env.ACHIEVEMENT_TEMPLATES = JSON.stringify({
            'v1/programmer': 4,
            'v1/santa': key,
            'v1/bad': 'santa',
            'v1/neg': -1,
            'v1/long': '0x' + 'a'.repeat(65),
        });
        assert.deepEqual(templateFor('v1', 'Programmer'), { id: 4 });
        assert.deepEqual(templateFor(null, 'santa'), { key: BigInt(key) });
        assert.equal(templateFor('v1', 'bad'), null);
        assert.equal(templateFor('v1', 'neg'), null);
        assert.equal(templateFor('v1', 'long'), null);
        assert.equal(templateFor('v1', 'unknown'), null);
    } finally {
        if (saved === undefined) delete process.env.ACHIEVEMENT_TEMPLATES;
        else process.env.ACHIEVEMENT_TEMPLATES = saved;
    }
});
