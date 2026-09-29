// Unit tests for per-chat point prices: validation/normalization of what a
// chat creator submits, the effective price every route converts with, and
// the member-facing "rate changed" notice. Pure functions, no Mongo.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_POINT_PRICE,
    compareDecimal,
    normalizePointPrice,
    platformPointPrice,
    pointPriceFor,
    hasCustomPointPrice,
    priceFitsDecimals,
    chatPointsToUnits,
    recentPointPriceChange,
    serializePriceHistory,
} = require('../src/lib/point-price');

const NOW = 1_800_000_000;
const DAY = 86400;

function withRate(rate, fn) {
    const saved = process.env.JETTONS_PER_POINT;
    if (rate === undefined) delete process.env.JETTONS_PER_POINT;
    else process.env.JETTONS_PER_POINT = rate;
    try {
        return fn();
    } finally {
        if (saved === undefined) delete process.env.JETTONS_PER_POINT;
        else process.env.JETTONS_PER_POINT = saved;
    }
}

test('normalizePointPrice returns one canonical spelling', () => {
    assert.equal(normalizePointPrice('0.01'), '0.01');
    assert.equal(normalizePointPrice(' 0.0100 '), '0.01');
    assert.equal(normalizePointPrice('007.50'), '7.5');
    assert.equal(normalizePointPrice('5.000'), '5');
    assert.equal(normalizePointPrice('0.000000001'), '0.000000001');
    assert.equal(normalizePointPrice(MAX_POINT_PRICE), MAX_POINT_PRICE);
    assert.equal(normalizePointPrice('999999.999999999'), '999999.999999999');
});

test('normalizePointPrice rejects non-strings, junk, zero and out-of-bounds prices', () => {
    // numbers already went through float rounding
    assert.throws(() => normalizePointPrice(0.01), /decimal string/);
    assert.throws(() => normalizePointPrice(null), /decimal string/);
    for (const bad of ['', '  ', 'abc', '-1', '1e-2', '.5', '1.', '1,5', '0x10', '1.2.3', '1'.repeat(40)]) {
        assert.throws(() => normalizePointPrice(bad), /decimal string/, bad);
    }
    assert.throws(() => normalizePointPrice('0'), /greater than 0/);
    assert.throws(() => normalizePointPrice('0.000'), /greater than 0/);
    assert.throws(() => normalizePointPrice('1000000.000000001'), /at most/);
    assert.throws(() => normalizePointPrice('2000000'), /at most/);
});

test('normalizePointPrice keeps one point worth at least one jetton unit', () => {
    // unknown decimals: validated against 9
    assert.throws(() => normalizePointPrice('0.0000000001'), /9 decimals/);
    assert.throws(() => normalizePointPrice('0.0000000001', null), /9 decimals/);
    assert.equal(normalizePointPrice('0.000001', 6), '0.000001');
    assert.throws(() => normalizePointPrice('0.0000001', 6), /6 decimals/);
    assert.equal(normalizePointPrice('3', 0), '3');
    assert.throws(() => normalizePointPrice('2.5', 0), /0 decimals/);
    // trailing zeros do not count
    assert.equal(normalizePointPrice('0.1000000000', 1), '0.1');
});

test('priceFitsDecimals re-checks a saved price against the jetton at claim time', () => {
    assert.equal(priceFitsDecimals('0.01', 9), true);
    assert.equal(priceFitsDecimals('0.01', 2), true);
    assert.equal(priceFitsDecimals('0.001', 2), false);
    assert.equal(priceFitsDecimals('5', 0), true);
    assert.equal(priceFitsDecimals('0.01', null), false);
});

test('compareDecimal compares exactly', () => {
    assert.equal(compareDecimal('0.01', '0.010'), 0);
    assert.equal(compareDecimal('0.009', '0.01'), -1);
    assert.equal(compareDecimal('10', '9.999999999'), 1);
    assert.equal(compareDecimal('0.1', '0.3'), -1);
});

test('pointPriceFor: the chat price when set, else the platform default', () => {
    withRate('0.0100', () => {
        assert.equal(platformPointPrice(), '0.01');
        assert.equal(pointPriceFor({ id: 1 }), '0.01');
        assert.equal(pointPriceFor({ id: 1, point_price: null }), '0.01');
        assert.equal(pointPriceFor(null), '0.01');
        assert.equal(pointPriceFor({ id: 1, point_price: '0.5' }), '0.5');
        assert.equal(hasCustomPointPrice({ point_price: '0.5' }), true);
        assert.equal(hasCustomPointPrice({}), false);
    });
    withRate(undefined, () => assert.equal(platformPointPrice(), '0.01'));
    withRate('2', () => assert.equal(pointPriceFor({ id: 1 }), '2'));
});

test('pointPriceFor refuses a corrupted stored price instead of paying another rate', () => {
    for (const bad of ['0', 'abc', 0.5, '-1']) {
        assert.throws(
            () => pointPriceFor({ point_price: bad }),
            (e) => e.status === 500 && /invalid/.test(e.message),
            String(bad),
        );
    }
    withRate('oops', () => assert.throws(() => pointPriceFor({}), /JETTONS_PER_POINT/));
});

test('chatPointsToUnits converts with the chat price, exactly', () => {
    withRate('0.01', () => {
        // platform: 150 points at 0.01 = 1.5 jettons of 9 decimals
        assert.equal(chatPointsToUnits({}, 150, 9), 1_500_000_000n);
        // chat price 0.3 (not representable as a float): 3 points = 0.9 exactly
        assert.equal(chatPointsToUnits({ point_price: '0.3' }, 3, 9), 900_000_000n);
        assert.equal(chatPointsToUnits({ point_price: '0.000001' }, 1, 6), 1n);
        assert.equal(chatPointsToUnits({ point_price: '1000000' }, 1_000_000_000, 9), 10n ** 24n);
    });
});

test('recentPointPriceChange reports the latest change of the last 7 days', () => {
    const chat = {
        point_price_history: [
            { old: '0.01', new: '0.02', at: new Date((NOW - 30 * DAY) * 1000), by: 1 },
            { old: '0.02', new: '0.005', at: new Date((NOW - 3 * DAY) * 1000), by: 1 },
            { old: '0.005', new: '0.01', at: new Date((NOW - DAY) * 1000), by: 1 },
        ],
    };
    assert.deepEqual(recentPointPriceChange(chat, NOW), { old: '0.005', new: '0.01', at: NOW - DAY, changes: 2 });
    // only the old change: nothing to warn about
    assert.equal(recentPointPriceChange({ point_price_history: chat.point_price_history.slice(0, 1) }, NOW), null);
    assert.equal(recentPointPriceChange({}, NOW), null);
    assert.equal(recentPointPriceChange(null, NOW), null);
    // exactly 7 days ago is out of the window
    assert.equal(
        recentPointPriceChange({ point_price_history: [{ old: '1', new: '2', at: new Date((NOW - 7 * DAY) * 1000) }] }, NOW),
        null,
    );
});

test('serializePriceHistory lists changes newest first', () => {
    const chat = {
        point_price_history: [
            { old: '0.01', new: '0.02', at: new Date(1000 * 1000), by: 7 },
            { old: '0.02', new: '0.03', at: new Date(2000 * 1000), by: 7 },
        ],
    };
    assert.deepEqual(serializePriceHistory(chat), [
        { old: '0.02', new: '0.03', at: 2000, by: 7 },
        { old: '0.01', new: '0.02', at: 1000, by: 7 },
    ]);
    assert.deepEqual(serializePriceHistory(chat, 1), [{ old: '0.02', new: '0.03', at: 2000, by: 7 }]);
    assert.deepEqual(serializePriceHistory({}), []);
});
