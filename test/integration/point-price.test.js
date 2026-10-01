// Integration tests for GET/POST /api/point-price against MongoDB: the
// conditional price writes (a save must not race another save or the bot),
// the `announcements` outbox the bot drains, a due decrease the bot has not
// applied, the payout coverage check, and the live creator check.
const h = require('./helpers');
const assert = require('node:assert/strict');
const { Address } = require('@ton/core');

const { itest, seed, chain, telegram, callApi, getCollection, getDb, ago, address, DAY_MS } = h;

h.setupIntegration();

const CHAT = -1009876543210;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');
const WALLET = address('alice-wallet');

const savePrice = (body, user = CREATOR) => callApi('point-price', { method: 'POST', user, body: { chatId: CHAT, ...body } });
const readPrice = (query = {}, user = CREATOR) => callApi('point-price', { user, query: { chatId: CHAT, ...query } });
const claim = () => callApi('claim-voucher', { method: 'POST', user: ALICE, body: { chatId: CHAT, wallet: WALLET } });
const chatDoc = async () => (await getCollection('chats')).findOne({ id: CHAT });
const outbox = async () => (await getCollection('announcements')).find({ chat_id: CHAT }).sort({ _id: 1 }).toArray();

async function seedChat(extra = {}) {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    chain.addPool(CHAT, { ledger: 10n ** 10n, limit: 10n ** 9n });
    telegram.setStatus(CHAT, CREATOR, 'creator');
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON, point_price: '0.02', claim_settings: { maturation_days: 3 }, ...extra });
}

const secondsFromNow = (days) => Math.floor((Date.now() + days * DAY_MS) / 1000);
const near = (actual, expected, slack = 60) => Math.abs(actual - expected) <= slack;

itest('schedule, replace and cancel a decrease', async () => {
    await seedChat();
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100);

    // schedule: the price stays, the decrease waits the 7-day notice
    const scheduled = await savePrice({ price: '0.01' });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
    assert.equal(scheduled.body.price, '0.02');
    assert.equal(scheduled.body.announced, true);
    // claims are open every day: the notice already covers a claim window
    const { claim_windows: windows, claims_open_throughout: openThroughout, ...pending } = scheduled.body.pending;
    assert.equal(openThroughout, true);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].end, scheduled.body.pending.effective_at);
    assert.deepEqual({ ...pending, effective_at: 0 }, {
        price: '0.01',
        to_default: false,
        from: '0.02',
        symbol: 'TST',
        effective_at: 0,
    });
    assert.ok(near(scheduled.body.pending.effective_at, secondsFromNow(7)));
    assert.deepEqual(scheduled.body.history, []);
    // a pending decrease brings the payout coverage along: Alice's 100 points
    // at 0.02 against the pool's 1 TST/day
    assert.equal(scheduled.body.coverage_error, null);
    assert.equal(scheduled.body.coverage.debt, '2000000000');
    assert.equal(scheduled.body.coverage.for_pending, true);

    let chat = await chatDoc();
    assert.equal(chat.point_price, '0.02');
    assert.equal(chat.point_price_pending.price, '0.01');
    const firstRequestedAt = chat.point_price_pending.requested_at;
    let rows = await outbox();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'price_decrease_scheduled');
    assert.deepEqual({ ...rows[0].params, effective_at: null }, { from: '0.02', to: '0.01', symbol: 'TST', effective_at: null });
    assert.equal(rows[0].sent_at, null);
    assert.equal(rows[0].attempts, 0);

    // during the notice members still claim at the old price
    const early = await claim();
    assert.equal(early.status, 200, JSON.stringify(early.body));
    assert.equal(early.body.jettons, '2');
    assert.equal(early.body.point_price, '0.02');

    // replace: another target restarts the notice and is announced again
    const replaced = await savePrice({ price: '0.015' });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.equal(replaced.body.price, '0.02');
    assert.equal(replaced.body.pending.price, '0.015');
    chat = await chatDoc();
    assert.equal(chat.point_price_pending.price, '0.015');
    assert.ok(chat.point_price_pending.requested_at > firstRequestedAt);
    rows = await outbox();
    assert.deepEqual(
        rows.map((r) => [r.type, r.params.to]),
        [
            ['price_decrease_scheduled', '0.01'],
            ['price_decrease_scheduled', '0.015'],
        ],
    );

    // the same target again changes nothing and announces nothing
    const same = await savePrice({ price: '0.0150' });
    assert.equal(same.status, 200);
    assert.equal(same.body.pending.price, '0.015');
    assert.equal(same.body.announced, undefined);
    assert.deepEqual((await chatDoc()).point_price_pending, chat.point_price_pending);
    assert.equal((await outbox()).length, 2);

    // cancel: the price stays where it was, the chat is told
    const cancelled = await savePrice({ cancelPending: true });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.price, '0.02');
    assert.equal(cancelled.body.pending, null);
    chat = await chatDoc();
    assert.equal(chat.point_price, '0.02');
    assert.equal(chat.point_price_pending, undefined);
    assert.deepEqual(chat.point_price_history ?? [], []);
    rows = await outbox();
    assert.equal(rows.length, 3);
    assert.equal(rows[2].type, 'price_decrease_cancelled');
    assert.deepEqual(rows[2].params, { from: '0.02', to: '0.015', symbol: 'TST' });

    // nothing left to cancel
    const again = await savePrice({ cancelPending: true });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /no price decrease is scheduled/);
    assert.equal((await outbox()).length, 3);
});

itest('an increase applies at once and cancels a pending decrease', async () => {
    await seedChat();
    assert.equal((await savePrice({ price: '0.01' })).status, 200);

    const raised = await savePrice({ price: '0.03' });
    assert.equal(raised.status, 200, JSON.stringify(raised.body));
    assert.equal(raised.body.price, '0.03');
    assert.equal(raised.body.pending, null);
    assert.equal(raised.body.history.length, 1);
    assert.deepEqual({ ...raised.body.history[0], at: null }, { old: '0.02', new: '0.03', at: null, by: CREATOR });

    const chat = await chatDoc();
    assert.equal(chat.point_price, '0.03');
    assert.equal(chat.point_price_pending, undefined);
    const rows = await outbox();
    assert.deepEqual(
        rows.map((r) => r.type),
        ['price_decrease_scheduled', 'price_increased'],
    );
    assert.deepEqual(rows[1].params, { from: '0.02', to: '0.03', symbol: 'TST', cancelled_pending: true });
});

itest('two saves at once (a double submit): one applies, the other gets 409', async () => {
    await seedChat();
    // both have read the chat before either writes
    telegram.hooks.getChatMemberStatus = h.barrier(2);
    const results = await Promise.all([savePrice({ price: '0.01' }), savePrice({ price: '0.015' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    const won = results.find((r) => r.status === 200);
    const chat = await chatDoc();
    assert.equal(chat.point_price_pending.price, won.body.pending.price);
    const rows = await outbox();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].params.to, won.body.pending.price);
});

itest('a save that races the bot applying the decrease gets 409 and announces nothing', async () => {
    const requestedAt = ago(8);
    await seedChat({
        point_price_pending: {
            price: '0.01',
            to_default: false,
            from: '0.02',
            symbol: 'TST',
            effective_at: ago(1),
            requested_at: requestedAt,
            by: CREATOR,
        },
    });

    // The bot applies the due decrease while the save is checking Telegram
    // (after the handler read the chat, before it writes).
    telegram.hooks.getChatMemberStatus = async () => {
        await (await getCollection('chats')).updateOne(
            { id: CHAT, 'point_price_pending.requested_at': requestedAt },
            {
                $set: { point_price: '0.01' },
                $unset: { point_price_pending: '' },
                $push: { point_price_history: { old: '0.02', new: '0.01', at: ago(1), by: CREATOR } },
            },
        );
    };
    const res = await savePrice({ price: '0.05' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /changed meanwhile/);

    const chat = await chatDoc();
    assert.equal(chat.point_price, '0.01');
    assert.equal(chat.point_price_history.length, 1);
    assert.deepEqual(await outbox(), []);

    // reloading and saving again works
    telegram.hooks.getChatMemberStatus = null;
    const retry = await savePrice({ price: '0.05' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.price, '0.05');
    assert.deepEqual(
        (await outbox()).map((r) => [r.type, r.params.from, r.params.to]),
        [['price_increased', '0.01', '0.05']],
    );
});

itest('a due decrease applies while the bot is down, and a save writes it out', async () => {
    const requestedAt = ago(8);
    const effectiveAt = ago(1);
    await seedChat({
        point_price_pending: {
            price: '0.01',
            to_default: false,
            from: '0.02',
            symbol: 'TST',
            effective_at: effectiveAt,
            requested_at: requestedAt,
            by: CREATOR,
        },
    });
    // 100 points matured long before the decrease; 40 were maturing when it
    // took effect (earned 3.5 days ago, matured 12 hours ago)
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.reaction(CHAT, ALICE, 40, ago(3.5));
    await seed.rewards(CHAT, ALICE, 140);
    const effectiveSec = Math.floor(effectiveAt.getTime() / 1000);

    // Members already see the new price and the change, not a pending drop.
    const dash = await callApi('me/chats', { user: ALICE });
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    const item = dash.body.rewards.find((r) => r.chat_id === CHAT);
    assert.equal(item.point_price, '0.01');
    assert.equal(item.point_price_custom, true);
    assert.equal(item.point_price_pending, null);
    assert.deepEqual(item.point_price_change, { old: '0.02', new: '0.01', at: effectiveSec, changes: 1 });
    assert.equal(item.available_points, 140);
    assert.equal(item.jettons, '1.8');
    assert.deepEqual(item.jettons_breakdown, [
        { price: '0.01', points: 100, jettons: '1' },
        { price: '0.02', points: 40, jettons: '0.8' },
    ]);

    // The creator sees it in effect too.
    const view = await readPrice();
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.price, '0.01');
    assert.equal(view.body.pending, null);
    assert.deepEqual(view.body.history, [{ old: '0.02', new: '0.01', at: effectiveSec, by: CREATOR }]);

    // A claim pays exactly what the dashboard showed.
    const claimed = await claim();
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(claimed.body.point_price, '0.01');
    assert.equal(claimed.body.jettons, '1.8');

    // The creator schedules a further decrease: the due one is written out
    // first (price, history, a "decreased" announcement, since the bot finding
    // its pending gone neither applies nor announces it), then the new one.
    const next = await savePrice({ price: '0.005' });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal(next.body.price, '0.01');
    assert.equal(next.body.pending.price, '0.005');
    assert.equal(next.body.pending.from, '0.01');

    const chat = await chatDoc();
    assert.equal(chat.point_price, '0.01');
    assert.equal(chat.point_price_pending.price, '0.005');
    // The due pending predates maturation snapshots, so writing it out records
    // the chat's setting at that moment.
    assert.deepEqual(chat.point_price_history, [
        { old: '0.02', new: '0.01', at: effectiveAt, by: CREATOR, maturation_days: 3 },
    ]);
    assert.deepEqual(
        (await outbox()).map((r) => [r.type, r.params.from, r.params.to]),
        [
            ['price_decreased', '0.02', '0.01'],
            ['price_decrease_scheduled', '0.01', '0.005'],
        ],
    );

    // The bot, back up, conditions on the pending it knew: nothing to apply.
    const botApply = await (await getCollection('chats')).updateOne(
        { id: CHAT, 'point_price_pending.requested_at': requestedAt },
        { $set: { point_price: '0.01' }, $unset: { point_price_pending: '' } },
    );
    assert.equal(botApply.matchedCount, 0);
});

itest('a failed outbox insert keeps the change and reports announced: false', async (t) => {
    await seedChat();
    const logged = t.mock.method(console, 'error', () => {});
    // an outbox that rejects every row
    await (await getDb()).createCollection('announcements', { validator: { $jsonSchema: { required: ['never_present'] } } });

    const res = await savePrice({ price: '0.01' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.announced, false);
    assert.equal(res.body.pending.price, '0.01');
    assert.equal((await chatDoc()).point_price_pending.price, '0.01');
    assert.deepEqual(await outbox(), []);
    assert.equal(logged.mock.callCount(), 1);
});

itest('coverage counts unclaimed points and issued vouchers against the pool', async () => {
    await seedChat();
    chain.pools.get(CHAT).admin = Address.parse(address('pool-admin'));
    await seed.grant(CHAT, ALICE, 100, ago(10));
    await seed.rewards(CHAT, ALICE, 100, 25);
    // the 25 claimed points sit in a voucher that can still be used
    await (await getCollection('claims')).insertOne({
        chat_id: CHAT,
        user_id: ALICE,
        points: 25,
        amount: '500000000',
        nonce: 1,
        jetton_master: JETTON,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        status: 'issued',
        created_at: Math.floor(Date.now() / 1000),
    });

    const res = await readPrice({ coverage: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const c = res.body.coverage;
    assert.equal(res.body.coverage_error, null);
    // 75 unclaimed points at 0.02 + the 0.5 TST voucher
    assert.equal(c.debt, '2000000000');
    assert.equal(c.debt_points, 75);
    assert.equal(c.members_owed, 1);
    assert.equal(c.issued_vouchers, '500000000');
    assert.equal(c.pool_balance, '10000000000');
    assert.equal(c.daily_limit, '1000000000');
    assert.equal(c.for_pending, false);
    assert.equal(c.enough_balance, true);
    assert.equal(c.pool_admin, address('pool-admin'));

    // without ?coverage=1 and nothing pending it is not computed
    const plain = await readPrice();
    assert.equal(plain.body.coverage, null);
});

itest('a creator check that goes stale: Telegram must confirm before any change', async () => {
    await seedChat();

    // ownership moved on in Telegram; the stored flag still says CREATOR
    telegram.setStatus(CHAT, CREATOR, 'administrator');
    const demoted = await savePrice({ price: '0.01' });
    assert.equal(demoted.status, 403);
    assert.match(demoted.body.error, /Telegram does not confirm/);

    // the bot cannot see the member: no change either
    telegram.statuses.clear();
    const unseen = await savePrice({ price: '0.05' });
    assert.equal(unseen.status, 403);
    const cancel = await savePrice({ cancelPending: true });
    assert.equal(cancel.status, 403);

    const chat = await chatDoc();
    assert.equal(chat.point_price, '0.02');
    assert.equal(chat.point_price_pending, undefined);
    assert.deepEqual(await outbox(), []);

    // reading stays on the stored flag
    assert.equal((await readPrice()).status, 200);

    // someone who is not the stored creator is refused before Telegram is asked
    telegram.setStatus(CHAT, ALICE, 'creator');
    telegram.calls.length = 0;
    const other = await savePrice({ price: '0.05' }, ALICE);
    assert.equal(other.status, 403);
    assert.match(other.body.error, /only the chat creator/);
    assert.equal((await readPrice({}, ALICE)).status, 403);
    assert.deepEqual(telegram.calls, []);

    // no init data at all
    const anon = await callApi('point-price', { method: 'POST', body: { chatId: CHAT, price: '0.05' } });
    assert.equal(anon.status, 401);
});
