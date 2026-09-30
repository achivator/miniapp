// Tests for the lot loader (lib/lots.js) and the maturing-points queries
// against a tiny in-memory stand-in for the bot's collections: a lot is dated
// whether its doc stores the date as a Date or as epoch ms, so a grant saved
// with a Date is valued (and matures) like any other, instead of falling into
// the legacy lot at the current price. No Mongo: the stub implements only the
// operators these queries use, with Mongo's type bracketing (a Date compares
// only with Dates, a number only with numbers).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const collections = new Map();
// before lots.js / claim-rules.js load: they take getCollection at require time
require('../src/lib/mongo').getCollection = async (name) => fakeCollection(collections.get(name) || []);

const { chatLots } = require('../src/lib/lots');
const { maturingPoints } = require('../src/lib/claim-rules');
const { dateMatch } = require('../src/lib/lot-dates');

process.env.JETTONS_PER_POINT = '0.01';

const DAY_MS = 86400 * 1000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const at = (days) => new Date(T0 + days * DAY_MS);
const ms = (days) => T0 + days * DAY_MS;
const DEC = 9;
const U = 10n ** 9n;
const CHAT = -100;
const USER = 7;

function sameBracket(value, arg) {
    if (arg instanceof Date) return value instanceof Date;
    if (typeof arg === 'number') return typeof value === 'number';
    return false;
}

function matchesCond(value, cond) {
    return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
            case '$in':
                return arg.includes(value);
            case '$type':
                return arg === 'date' ? value instanceof Date : typeof value === 'number';
            case '$gt':
                return sameBracket(value, arg) && +value > +arg;
            case '$gte':
                return sameBracket(value, arg) && +value >= +arg;
            case '$lt':
                return sameBracket(value, arg) && +value < +arg;
            case '$lte':
                return sameBracket(value, arg) && +value <= +arg;
            default:
                throw new Error(`stub: unsupported operator ${op}`);
        }
    });
}

function matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
        if (key === '$or') return cond.some((f) => matches(doc, f));
        if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) return matchesCond(doc[key], cond);
        return doc[key] === cond;
    });
}

function evalExpr(doc, expr) {
    if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)];
    if (expr && expr.$toLong !== undefined) return Math.trunc(+evalExpr(doc, expr.$toLong));
    throw new Error(`stub: unsupported expression ${JSON.stringify(expr)}`);
}

function group(docs, spec) {
    const out = new Map();
    for (const doc of docs) {
        const id = spec._id === null ? null : evalExpr(doc, spec._id);
        const row = out.get(id) || { _id: id };
        for (const [field, acc] of Object.entries(spec)) {
            if (field === '_id') continue;
            const [op, expr] = Object.entries(acc)[0];
            const v = evalExpr(doc, expr);
            if (op === '$sum') row[field] = (row[field] || 0) + v;
            else if (op === '$min') row[field] = row[field] === undefined || v < row[field] ? v : row[field];
            else throw new Error(`stub: unsupported accumulator ${op}`);
        }
        out.set(id, row);
    }
    return [...out.values()];
}

function fakeCollection(docs) {
    return {
        aggregate(pipeline) {
            let rows = docs;
            for (const stage of pipeline) {
                if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
                else if (stage.$group) rows = group(rows, stage.$group);
                else throw new Error(`stub: unsupported stage ${Object.keys(stage)}`);
            }
            return { toArray: async () => rows };
        },
        find(filter) {
            return { toArray: async () => docs.filter((d) => matches(d, filter)).map((d) => ({ ...d })) };
        },
    };
}

test('dateMatch selects both date types, and nothing else', () => {
    const f = dateMatch({ gt: ms(-1), lt: ms(1) });
    assert.equal(matches({ date: at(0) }, f), true);
    assert.equal(matches({ date: ms(0) }, f), true);
    assert.equal(matches({ date: at(2) }, f), false);
    assert.equal(matches({ date: ms(2) }, f), false);
    assert.equal(matches({ date: String(ms(0)) }, f), false);
    assert.equal(matches({}, dateMatch({})), false);
    assert.equal(matches({ date: at(0) }, dateMatch({})), true);
});

test('grants and reactions are dated lots whether their date is a Date or epoch ms', async () => {
    // 10 -> 5 at T0 with 3 days' maturation: lots earned in (-3, 0) keep 10
    const chat = {
        id: CHAT,
        point_price: '5',
        point_price_history: [{ old: '10', new: '5', at: at(0), by: 1, maturation_days: 3 }],
        claim_settings: { maturation_days: 3 },
    };
    collections.set('grants', [
        { chat_id: CHAT, user_id: USER, points: 2, date: at(-1) }, // a grant saved with a Date
        { chat_id: CHAT, user_id: USER, points: 3, date: ms(-1.5) }, // as the bot writes it
        { chat_id: CHAT, user_id: USER, points: 4, date: at(-10) }, // long matured
        { chat_id: CHAT, user_id: 8, points: 50, date: at(-1) }, // someone else
    ]);
    collections.set('reaction_points', [
        { chat_id: CHAT, receiver_id: USER, points: 1, date: at(-0.5) }, // as the bot writes it
        { chat_id: CHAT, receiver_id: USER, points: 6, date: ms(-2) }, // a reaction saved with epoch ms
        { chat_id: CHAT, receiver_id: USER, points: 5, date: ms(2) }, // earned at the new price
    ]);
    const record = { user_id: USER, points: 21, claimed_points: 0 };
    const lots = await chatLots(chat, [USER], at(30));
    // every doc is a dated lot: nothing is left for the legacy lot
    assert.equal(lots.lotsOf(record).some((l) => l.legacy), false);
    const owed = lots.owed(record, DEC);
    // at 5: the lot matured before the drop (4) and the one earned after it
    // (5); at 10: the four lots still maturing at the drop, of both types
    assert.deepEqual(
        owed.breakdown.map((b) => [b.price, b.points]),
        [
            ['5', 9],
            ['10', 12],
        ],
    );
    assert.equal(owed.units, (9n * 5n + 12n * 10n) * U);

    // without a decrease: one sum per member, still both types
    const plain = await chatLots({ id: CHAT, point_price: '5', claim_settings: { maturation_days: 3 } }, [USER], at(30));
    assert.equal(plain.lotsOf(record).some((l) => l.legacy), false);
});

test('a grant saved with a Date matures like any other', async () => {
    collections.set('grants', [
        { chat_id: CHAT, user_id: USER, points: 2, date: at(-1) },
        { chat_id: CHAT, user_id: USER, points: 3, date: ms(-0.5) },
        { chat_id: CHAT, user_id: USER, points: 4, date: at(-10) },
    ]);
    collections.set('reaction_points', [{ chat_id: CHAT, receiver_id: USER, points: 1, date: ms(-2) }]);
    const nowSec = Math.floor(ms(0) / 1000);
    const m = await maturingPoints(CHAT, USER, 3, nowSec);
    assert.equal(m.points, 6);
    // the oldest maturing lot (the reaction at -2) matures at +1
    assert.equal(m.next_at, Math.floor(ms(1) / 1000));
});
