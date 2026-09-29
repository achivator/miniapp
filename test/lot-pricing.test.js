// Unit tests for lot valuation: which price each earned point is paid at once
// the price has moved (points still maturing when a decrease took effect keep
// the earlier price), FIFO consumption by claims, the legacy remainder, the
// cut to what the pool can pay, and rounding. Pure functions, no Mongo.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    priceTimeline,
    priceAt,
    priceBefore,
    priceDecreases,
    lotPrice,
    normalizeLots,
    valueClaim,
    serializeBreakdown,
    affectedWindow,
} = require('../src/lib/lot-pricing');
const { _dateRange: dateRange } = require('../src/lib/lots');
const { pointsToJettons } = require('../src/lib/ton/amounts');

const DAY_MS = 86400 * 1000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // a decrease moment used below
const at = (days) => new Date(T0 + days * DAY_MS);
const ms = (days) => T0 + days * DAY_MS;
const DEC = 9;
const U = 10n ** 9n; // one jetton in units

process.env.JETTONS_PER_POINT = '0.01';

// A chat whose price was `from` and dropped to `to` at T0 (as the bot writes
// it out), plus optional later entries.
function chatWith(history, pointPrice) {
    return { id: 1, point_price: pointPrice, point_price_history: history };
}
const drop = (old, next, when) => ({ old, new: next, at: when, by: 1 });

function value(chat, lots, { claimed = 0, count, maturationDays = 3, now = at(30), payable = null, decimals = DEC } = {}) {
    const timeline = priceTimeline(chat, now);
    const total = lots.reduce((s, l) => s + l.points, 0);
    return valueClaim({
        lots: normalizeLots(lots, total),
        claimed,
        count: count ?? total - claimed,
        timeline,
        maturationDays,
        decimals,
        payable,
    });
}

test('no history: every lot is paid at the current price (same as before lots)', () => {
    const chat = { id: 1, point_price: '2' };
    const timeline = priceTimeline(chat, at(0));
    assert.deepEqual(timeline, { current: '2', initial: null, steps: [] });
    assert.deepEqual(priceDecreases(timeline), []);
    const lots = [
        { points: 5, at: at(-10) },
        { points: 7, at: ms(-1) },
    ];
    const v = value(chat, lots, { now: at(0) });
    assert.equal(v.points, 12);
    assert.equal(v.units, pointsToJettons(12, '2', DEC));
    assert.deepEqual(v.breakdown, [{ price: '2', points: 12, units: 24n * U }]);
    // platform default price
    const d = value({ id: 1 }, lots, { now: at(0) });
    assert.equal(d.units, pointsToJettons(12, '0.01', DEC));
});

test('price timeline: price at / just before a moment', () => {
    const chat = chatWith([drop('10', '5', at(0)), drop('5', '12', at(10))], '12');
    const t = priceTimeline(chat, at(30));
    assert.equal(t.current, '12');
    assert.equal(t.initial, '10');
    assert.equal(priceAt(t, ms(-1)), '10'); // before any entry: the first entry's old
    assert.equal(priceAt(t, ms(0)), '5'); // a change counts from its moment
    assert.equal(priceBefore(t, ms(0)), '10');
    assert.equal(priceAt(t, ms(20)), '12');
    assert.deepEqual(priceDecreases(t), [{ at: ms(0), before: '10', after: '5' }]);
    // entries after `now` (none should exist) and unreadable ones are ignored
    const odd = chatWith([drop('10', '5', at(0)), drop('5', 'abc', at(1)), { old: '5', new: '1', at: 'x' }, drop('5', '1', at(99))], '5');
    assert.deepEqual(priceTimeline(odd, at(30)).steps, [{ at: ms(0), price: '5' }]);
});

test('a decrease: lots matured before it pay the new price, lots maturing across it keep the old one', () => {
    const chat = chatWith([drop('10', '5', at(0))], '5');
    const timeline = priceTimeline(chat, at(30));
    const price = (earned) => lotPrice(earned, timeline, 3);
    assert.equal(price(ms(-5)), '5'); // claimable since day -2: had the notice
    assert.equal(price(ms(-3)), '5'); // matured exactly at the decrease: claimable then
    assert.equal(price(ms(-3) + 1), '10'); // matured 1 ms after it
    assert.equal(price(ms(-1)), '10'); // still maturing: keeps the old price
    assert.equal(price(ms(0)), '5'); // earned at the new price
    assert.equal(price(ms(1)), '5');

    const v = value(
        chat,
        [
            { points: 4, at: at(-5) },
            { points: 3, at: at(-1) },
            { points: 2, at: at(1) },
        ],
    );
    assert.deepEqual(v.breakdown, [
        { price: '5', points: 6, units: 30n * U },
        { price: '10', points: 3, units: 30n * U },
    ]);
    assert.equal(v.units, 60n * U);
    assert.equal(v.points, 9);
});

test('maturation 0: no point is ever maturing, a decrease applies to all', () => {
    const chat = chatWith([drop('10', '5', at(0))], '5');
    const v = value(chat, [{ points: 3, at: at(-0.5) }], { maturationDays: 0 });
    assert.deepEqual(serializeBreakdown(v.breakdown), [{ price: '5', points: 3, units: String(15n * U) }]);
});

test('several decreases: the price before the earliest one inside the maturation window', () => {
    const chat = chatWith([drop('10', '8', at(0)), drop('8', '5', at(1))], '5');
    const timeline = priceTimeline(chat, at(30));
    assert.equal(lotPrice(ms(-1), timeline, 3), '10'); // both drops inside: before the first
    assert.equal(lotPrice(ms(0.5), timeline, 3), '8'); // only the second drop inside
    assert.equal(lotPrice(ms(-2.5), timeline, 3), '10'); // matures at 0.5: first drop inside
    assert.equal(lotPrice(ms(-3), timeline, 3), '5'); // matured exactly at the first drop: claimable in both notices
    assert.equal(lotPrice(ms(-4), timeline, 3), '5'); // matured at -1: claimable during both notices
    assert.equal(lotPrice(ms(2), timeline, 3), '5');
});

test('an increase after a decrease: max(current, price before the drop)', () => {
    // raised above the old price: everyone gets the current one
    const up = chatWith([drop('10', '5', at(0)), drop('5', '12', at(10))], '12');
    let t = priceTimeline(up, at(30));
    assert.equal(lotPrice(ms(-1), t, 3), '12');
    assert.equal(lotPrice(ms(-5), t, 3), '12');
    // raised, but not back to the old price: the protected lot keeps 10
    const partial = chatWith([drop('10', '5', at(0)), drop('5', '7', at(10))], '7');
    t = priceTimeline(partial, at(30));
    assert.equal(lotPrice(ms(-1), t, 3), '10');
    assert.equal(lotPrice(ms(-5), t, 3), '7');
    // an increase then a decrease inside one maturation window: the price
    // just before the decrease (the raised one)
    const bump = chatWith([drop('10', '12', at(0)), drop('12', '10', at(1))], '10');
    t = priceTimeline(bump, at(30));
    assert.deepEqual(priceDecreases(t), [{ at: ms(1), before: '12', after: '10' }]);
    assert.equal(lotPrice(ms(-1), t, 3), '12');
});

test('a due decrease the bot has not applied yet already counts', () => {
    const chat = {
        id: 1,
        point_price: '10',
        point_price_history: [],
        point_price_pending: {
            price: '5',
            to_default: false,
            from: '10',
            symbol: null,
            effective_at: at(0),
            requested_at: at(-7),
            by: 1,
        },
    };
    // before it is due: no decrease at all
    let t = priceTimeline(chat, at(-1));
    assert.equal(t.current, '10');
    assert.deepEqual(priceDecreases(t), []);
    t = priceTimeline(chat, at(1));
    assert.equal(t.current, '5');
    assert.deepEqual(priceDecreases(t), [{ at: ms(0), before: '10', after: '5' }]);
    assert.equal(lotPrice(ms(-1), t, 3), '10');
});

test('a corrupted current price is refused, as by pointPriceFor', () => {
    assert.throws(() => priceTimeline({ id: 1, point_price: 'abc' }, at(0)), (e) => e.status === 500);
});

test('FIFO: claimed points use the oldest lots first, partial claims continue where they stopped', () => {
    const chat = chatWith([drop('10', '5', at(0))], '5');
    const lots = [
        { points: 10, at: at(-5) }, // 5
        { points: 5, at: at(-1) }, // 10 (protected)
        { points: 5, at: at(2) }, // 5
    ];
    // the first 8 are claimed: 2 left of the oldest lot, then the protected one
    let v = value(chat, lots, { claimed: 8, count: 7 });
    assert.deepEqual(v.breakdown.map((b) => [b.price, b.points]), [
        ['5', 2],
        ['10', 5],
    ]);
    assert.equal(v.units, 60n * U);
    // exactly at a lot boundary
    v = value(chat, lots, { claimed: 10, count: 5 });
    assert.deepEqual(v.breakdown.map((b) => [b.price, b.points]), [['10', 5]]);
    // off by one around the boundary
    v = value(chat, lots, { claimed: 9, count: 2 });
    assert.deepEqual(v.breakdown.map((b) => [b.price, b.points]), [
        ['5', 1],
        ['10', 1],
    ]);
    v = value(chat, lots, { claimed: 11, count: 5 });
    assert.deepEqual(v.breakdown.map((b) => [b.price, b.points]), [
        ['10', 4],
        ['5', 1],
    ]);
    // count beyond the lots: only what exists
    v = value(chat, lots, { claimed: 18, count: 10 });
    assert.equal(v.points, 2);
    // everything claimed
    v = value(chat, lots, { claimed: 20, count: 5 });
    assert.equal(v.points, 0);
    assert.equal(v.units, 0n);
});

test('legacy remainder: points no lot explains are the oldest lot, at epoch 0', () => {
    const lots = normalizeLots([{ points: 5, at: at(-1) }], 12);
    assert.deepEqual(lots, [
        { at: 0, points: 7, legacy: true },
        { at: ms(-1), points: 5 },
    ]);
    const chat = chatWith([drop('10', '5', at(0))], '5');
    const t = priceTimeline(chat, at(30));
    // the legacy points are claimed first, at the current price
    const v = valueClaim({ lots, claimed: 0, count: 9, timeline: t, maturationDays: 3, decimals: DEC });
    assert.deepEqual(v.breakdown.map((b) => [b.price, b.points]), [
        ['5', 7],
        ['10', 2],
    ]);
    // no lots at all (all legacy): the current price, like before lots
    assert.deepEqual(normalizeLots([], 3), [{ at: 0, points: 3, legacy: true }]);
    assert.deepEqual(normalizeLots(null, 0), []);
});

test('lots beyond rewards.points are cut from the newest end; junk lots are ignored', () => {
    const lots = normalizeLots(
        [
            { points: 5, at: at(-2) },
            { points: 4, at: at(-1) },
            { points: 3, at: at(0) },
            { points: -2, at: at(0) },
            { points: 1.5, at: at(0) },
            { points: 2, at: null },
            { points: 2, at: 'yesterday' },
        ],
        7,
    );
    assert.deepEqual(lots, [
        { at: ms(-2), points: 5 },
        { at: ms(-1), points: 2 },
    ]);
});

test('grants with numeric dates and reactions with Date dates sort together', () => {
    const lots = normalizeLots(
        [
            { points: 1, at: at(-1) }, // reaction (Date)
            { points: 2, at: ms(-3) }, // grant (epoch ms)
            { points: 3, at: at(-2) },
        ],
        6,
    );
    assert.deepEqual(lots.map((l) => l.points), [2, 3, 1]);
    const chat = chatWith([drop('10', '5', at(0))], '5');
    const t = priceTimeline(chat, at(30));
    // the grant earned at -3 matured exactly at the decrease; the others did not
    const v = valueClaim({ lots, claimed: 0, count: 6, timeline: t, maturationDays: 3, decimals: DEC });
    assert.deepEqual(v.breakdown.map((b) => [b.price, b.points]), [
        ['5', 2],
        ['10', 4],
    ]);
});

test('payable: lots are taken oldest first while they fit, then what fits of the next one', () => {
    const chat = chatWith([drop('10', '5', at(0))], '5');
    const lots = [
        { points: 4, at: at(-5) }, // 5 each = 20
        { points: 3, at: at(-1) }, // 10 each = 30
        { points: 10, at: at(1) }, // 5 each
    ];
    // exactly the first lot
    let v = value(chat, lots, { payable: 20n * U });
    assert.equal(v.points, 4);
    assert.equal(v.units, 20n * U);
    // first lot + 1.5 points' worth of the protected one: 1 point fits
    v = value(chat, lots, { payable: 35n * U });
    assert.equal(v.points, 5);
    assert.equal(v.units, 30n * U);
    // stops at the protected lot even though a cheaper lot comes after it:
    // FIFO positions stay contiguous
    v = value(chat, lots, { payable: 29n * U });
    assert.equal(v.points, 4);
    assert.equal(v.units, 20n * U);
    // less than one point
    v = value(chat, lots, { payable: 4n * U });
    assert.equal(v.points, 0);
    assert.equal(v.units, 0n);
    v = value(chat, lots, { payable: 0n });
    assert.equal(v.points, 0);
    // plenty
    v = value(chat, lots, { payable: 10n ** 30n });
    assert.equal(v.points, 17);
    assert.equal(v.units, (20n + 30n + 50n) * U);
    // never above payable, for every payable
    for (let p = 0n; p <= 110n; p += 1n) {
        const r = value(chat, lots, { payable: p * U + 7n });
        assert.ok(r.units <= p * U + 7n, `payable ${p}`);
    }
});

test('rounding: floor per price group; never above the sum of exact values', () => {
    // an old price finer than the (switched) jetton's unit: 0.15 with 1 decimal
    const chat = chatWith([drop('0.15', '0.1', at(0))], '0.1');
    const lots = [
        { points: 1, at: at(-1) }, // 0.15 (protected)
        { points: 2, at: at(-0.5) }, // 0.15 (protected)
        { points: 3, at: at(1) }, // 0.1
    ];
    const v = value(chat, lots, { decimals: 1 });
    // 3 x 0.15 = 0.45 -> 4 units (floor of 4.5), 3 x 0.1 = 3 units
    assert.deepEqual(v.breakdown, [
        { price: '0.15', points: 3, units: 4n },
        { price: '0.1', points: 3, units: 3n },
    ]);
    assert.equal(v.units, 7n);
    // exact value: 0.45 + 0.3 = 0.75 jettons = 7.5 units
    assert.ok(v.units * 2n <= 15n);
    // the payable cut respects the same rounding
    const cut = value(chat, lots, { decimals: 1, payable: 4n });
    assert.equal(cut.units, 4n);
    assert.equal(cut.points, 3);
    const cut2 = value(chat, lots, { decimals: 1, payable: 2n });
    assert.equal(cut2.points, 1); // 1 x 0.15 = 1 unit; 2 x 0.15 = 3 units > 2
    assert.equal(cut2.units, 1n);
    // prices that fit the decimals convert exactly
    const exact = value(chatWith([drop('0.3', '0.1', at(0))], '0.1'), lots, { decimals: 9 });
    assert.equal(exact.units, 900_000_000n + 300_000_000n);
});

test('valueClaim needs the jetton decimals', () => {
    const t = priceTimeline({ id: 1, point_price: '1' }, at(0));
    assert.throws(() => valueClaim({ lots: [], claimed: 0, count: 1, timeline: t, maturationDays: 3, decimals: null }), /decimals/);
});

test('summing lots outside the affected window gives the same value as reading them one by one', () => {
    // what lib/lots.js relies on: lots earned at or before (first decrease -
    // maturation) and at or after the last decrease may be merged
    const chat = chatWith([drop('10', '8', at(0)), drop('8', '12', at(2)), drop('12', '5', at(6))], '5');
    const t = priceTimeline(chat, at(40));
    let seed = 7;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed / 2 ** 31;
    };
    for (const maturationDays of [0, 1, 3, 10]) {
        const w = affectedWindow(t, maturationDays);
        for (let round = 0; round < 30; round++) {
            const lots = [];
            for (let i = 0; i < 25; i++) {
                const day = Math.floor(rand() * 40) - 20 + (rand() < 0.2 ? 0 : rand());
                lots.push({ points: 1 + Math.floor(rand() * 5), at: ms(day) });
            }
            // include the window edges themselves
            lots.push({ points: 2, at: w.from }, { points: 3, at: w.to });
            const total = lots.reduce((s, l) => s + l.points, 0) + 4; // + legacy
            const head = lots.filter((l) => l.at <= w.from).reduce((s, l) => s + l.points, 0);
            const tail = lots.filter((l) => l.at > w.from && l.at >= w.to).reduce((s, l) => s + l.points, 0);
            const middle = lots.filter((l) => l.at > w.from && l.at < w.to);
            const merged = [...middle, { points: head, at: w.from }, { points: tail, at: w.to }];
            for (const claimed of [0, 5, 17, 40]) {
                const args = { claimed, count: total, timeline: t, maturationDays, decimals: DEC };
                const a = valueClaim({ ...args, lots: normalizeLots(lots, total) });
                const b = valueClaim({ ...args, lots: normalizeLots(merged, total) });
                assert.equal(a.units, b.units, `mat ${maturationDays} claimed ${claimed}`);
                assert.equal(a.points, b.points);
            }
        }
    }
    assert.equal(affectedWindow(priceTimeline({ id: 1, point_price: '1' }, at(0)), 3), null);
});

test('the loader date ranges split lots into head, middle and tail exactly once', () => {
    const match = (cond, v) =>
        (cond.$gt === undefined || v > cond.$gt) &&
        (cond.$gte === undefined || v >= cond.$gte) &&
        (cond.$lt === undefined || v < cond.$lt) &&
        (cond.$lte === undefined || v <= cond.$lte);
    for (const [from, to] of [
        [100, 200],
        [150, 150],
    ]) {
        for (const asDate of [true, false]) {
            const ranges = [dateRange(asDate, { lte: from }), dateRange(asDate, { gt: from, gte: to }), dateRange(asDate, { gt: from, lt: to })];
            for (const v of [0, 99, 100, 101, 149, 150, 151, 199, 200, 201, 1e12]) {
                const date = asDate ? new Date(v) : v;
                const hits = ranges.filter((r) => match(r, date)).length;
                assert.equal(hits, 1, `from ${from} to ${to} at ${v} (${asDate ? 'Date' : 'number'})`);
            }
            // the bounds have the collection's date type
            assert.equal(ranges[0].$lte instanceof Date, asDate);
        }
    }
    assert.deepEqual(dateRange(true, {}), { $type: 'date' });
    assert.deepEqual(dateRange(false, {}), { $type: 'number' });
});
