// Unit tests for the subscription state and price table the mini app shows
// and sells from; the bot enforces the same states (telegram-bot/subscription.mjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TIERS, parseTiers, serviceState, tierFor, subscriptionPayload } = require('../src/lib/subscription');

const DAY_MS = 86400 * 1000;
const NOW = new Date(Date.UTC(2026, 9, 1, 12));
const ago = (days) => new Date(NOW.getTime() - days * DAY_MS);
const ahead = (days) => new Date(NOW.getTime() + days * DAY_MS);
const ON = { enabled: true, trialDays: 14, graceDays: 3, tiers: DEFAULT_TIERS };

test('off: every chat accrues', () => {
    assert.deepEqual(serviceState({}, NOW, { ...ON, enabled: false }), {
        state: 'off',
        accrues: true,
        ends_at: null,
        grace_until: null,
    });
});

test('trial, grace and expiry follow trial_started_at', () => {
    assert.equal(serviceState({}, NOW, ON).state, 'not_started');
    assert.equal(serviceState({}, NOW, ON).accrues, false);
    const trial = serviceState({ trial_started_at: ago(10) }, NOW, ON);
    assert.equal(trial.state, 'trial');
    assert.equal(trial.ends_at.getTime(), ahead(4).getTime());
    assert.equal(trial.grace_until.getTime(), ahead(7).getTime());
    assert.deepEqual(
        [15, 16, 17].map((d) => {
            const s = serviceState({ trial_started_at: ago(d) }, NOW, ON);
            return [s.state, s.accrues];
        }),
        [
            ['grace', true],
            ['grace', true],
            ['expired', false],
        ],
    );
});

test('a payment extends past the trial; the later end wins', () => {
    const paid = serviceState({ trial_started_at: ago(20), paid_until: ahead(25) }, NOW, ON);
    assert.equal(paid.state, 'paid');
    assert.equal(paid.ends_at.getTime(), ahead(25).getTime());
    // paid before the trial is over: still counted as paid
    assert.equal(serviceState({ trial_started_at: ago(1), paid_until: ahead(30) }, NOW, ON).state, 'paid');
    assert.equal(serviceState({ trial_started_at: ago(40), paid_until: ago(1) }, NOW, ON).state, 'grace');
    assert.equal(serviceState({ trial_started_at: ago(40), paid_until: ago(5) }, NOW, ON).state, 'expired');
});

test('the price follows active members', () => {
    assert.deepEqual(
        [0, 50, 51, 300, 301, 1001, 50000].map((n) => tierFor(n, DEFAULT_TIERS).stars),
        [100, 100, 300, 300, 750, 1500, 1500],
    );
});

test('an invalid price table falls back to the default', () => {
    assert.deepEqual(parseTiers('[{"minActive":0,"stars":10},{"minActive":100,"stars":20}]'), [
        { minActive: 0, stars: 10 },
        { minActive: 100, stars: 20 },
    ]);
    for (const raw of ['nope', '[]', '[{"minActive":5,"stars":10}]', '[{"minActive":0,"stars":0}]', '[{"minActive":0,"stars":20000}]']) {
        assert.equal(parseTiers(raw), DEFAULT_TIERS, raw);
    }
});

test('the invoice payload names the chat', () => {
    assert.equal(subscriptionPayload(-1001234567890), 'sub:-1001234567890');
});
