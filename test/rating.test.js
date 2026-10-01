// A chat's achievement rating (lib/rating.js): the order, what a member sees
// of the others, and who may see it at all.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    achieversPipeline,
    canSeeRating,
    medalsByUser,
    publicEntry,
    publicName,
    rankMembers,
} = require('../src/lib/rating');

const row = (id, achievements, reachedAt = null) => ({ _id: id, achievements, reached_at: reachedAt });
const ids = (list) => list.map((m) => m.user_id);

test('more achievements rank first', () => {
    const { top, total, me } = rankMembers([row(1, 2), row(2, 5), row(3, 3)], new Map(), { userId: 1 });
    assert.deepEqual(ids(top), [2, 3, 1]);
    assert.deepEqual(top.map((m) => m.rank), [1, 2, 3]);
    assert.equal(total, 3);
    assert.equal(me, null, 'in the top: no separate row');
});

test('ties go to more points, then to whoever got there first, then the lower id', () => {
    const rows = [row(10, 4, 5000), row(11, 4, 3000), row(12, 4, 3000), row(13, 4, 1000), row(14, 4, null)];
    const points = new Map([
        [10, 50],
        [13, 20],
    ]);
    const { top } = rankMembers(rows, points, {});
    // 10 by points; 13 earliest; 11 and 12 the same moment: by id; no date last
    assert.deepEqual(ids(top), [10, 13, 11, 12, 14]);
});

test('points missing or null count as zero', () => {
    const points = new Map([
        [1, null],
        [2, 1],
    ]);
    assert.deepEqual(ids(rankMembers([row(1, 1), row(2, 1), row(3, 1)], points, {}).top), [2, 1, 3]);
});

test('members without achievements or without an id are not rated', () => {
    const { top, total } = rankMembers([row(1, 0), row(null, 3), row(2, 1)], new Map(), {});
    assert.deepEqual(ids(top), [2]);
    assert.equal(total, 1);
});

test('the requester below the top gets their own row with their rank', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i + 1, 100 - i));
    const { top, me, total } = rankMembers(rows, new Map(), { userId: 55, limit: 50 });
    assert.equal(top.length, 50);
    assert.equal(total, 60);
    assert.equal(me.user_id, 55);
    assert.equal(me.rank, 55);
    assert.equal(rankMembers(rows, new Map(), { userId: 50, limit: 50 }).me, null, 'last of the top');
    assert.equal(rankMembers(rows, new Map(), { userId: 999, limit: 50 }).me, null, 'not rated');
});

test('an entry carries a name, the count and medals, never ids or points', () => {
    const [member] = rankMembers([row(7, 2, 1000)], new Map([[7, 900]]), {}).top;
    const entry = publicEntry(member, {
        names: new Map([[7, 'Ann']]),
        medals: new Map([[7, [{ type: 'newbie', collection: 'v1' }]]]),
        userId: 7,
    });
    assert.deepEqual(entry, {
        rank: 1,
        name: 'Ann',
        achievements: 2,
        medals: [{ type: 'newbie', collection: 'v1' }],
        me: true,
    });
    const other = publicEntry(member, { names: new Map(), medals: new Map(), userId: 8 });
    assert.equal(other.name, null);
    assert.deepEqual(other.medals, []);
    assert.equal(other.me, false);
    assert.ok(!JSON.stringify(entry).includes('900'));
});

test('publicName: first name, else @username, else nothing', () => {
    assert.equal(publicName({ first_name: ' Ann ', username: 'ann' }), 'Ann');
    assert.equal(publicName({ first_name: null, username: 'ann_b' }), '@ann_b');
    assert.equal(publicName({ first_name: '', username: '' }), null);
    assert.equal(publicName(null), null);
});

test('medalsByUser: oldest first, one per type and collection', () => {
    const medals = medalsByUser([
        { user_id: 1, type: 'talkative', collection: 'v1', date: 3000 },
        { user_id: 1, type: 'newbie', date: 1000 },
        { user_id: 1, type: 'newbie', collection: 'v1', date: 2000 }, // a duplicate from a race
        { user_id: 2, type: 'voicy', collection: 'v1', date: 500 },
    ]);
    assert.deepEqual(medals.get(1), [
        { type: 'newbie', collection: 'v1' },
        { type: 'talkative', collection: 'v1' },
    ]);
    assert.deepEqual(medals.get(2), [{ type: 'voicy', collection: 'v1' }]);
});

test('the aggregation starts with a match on the chat (index-backed) and counts distinct types', () => {
    const pipeline = achieversPipeline(-100123);
    assert.deepEqual(pipeline[0], { $match: { chat_id: -100123 } });
    assert.deepEqual(Object.keys(pipeline[1].$group._id), ['user_id', 'type', 'collection']);
    assert.equal(pipeline[2].$group._id, '$_id.user_id');
});

test('only members see the rating; Telegram decides when it can', () => {
    for (const status of ['creator', 'administrator', 'member', 'restricted']) {
        assert.equal(canSeeRating({ status, hasRecord: false }), true, status);
    }
    for (const status of ['left', 'kicked']) {
        assert.equal(canSeeRating({ status, hasRecord: true }), false, status);
    }
    // the bot cannot ask Telegram: the dashboard's signal (rewards / achievements)
    assert.equal(canSeeRating({ status: null, hasRecord: true }), true);
    assert.equal(canSeeRating({ status: null, hasRecord: false }), false);
});
