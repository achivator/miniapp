// Integration tests for GET /api/pool-status against MongoDB: what the pool
// page tells the chat creator about announcements that cannot reach the chat
// (the bot's chats.bot_cannot_post_at) and a group upgraded to a supergroup.
const h = require('./helpers');
const assert = require('node:assert/strict');

const { itest, seed, chain, callApi, address } = h;

h.setupIntegration();

const OLD = -555001;
const NEW = -1005550010001;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');

const status = (user = CREATOR, chatId = OLD) => callApi('pool-status', { user, query: { chatId } });

itest('the creator is told when the bot cannot post in the chat', async () => {
    chain.addJetton(JETTON);
    chain.addPool(OLD);
    await seed.chat({ id: OLD, creator: CREATOR, jetton_master: JETTON });
    let res = await status();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.bot_cannot_post, null);
    assert.equal(res.body.migrated, null);

    const at = new Date(Date.now() - 3600 * 1000);
    await (await h.getCollection('chats')).updateOne(
        { id: OLD },
        { $set: { bot_cannot_post_at: at, bot_cannot_post_reason: 'Forbidden: bot was kicked from the group chat' } },
    );
    res = await status();
    assert.deepEqual(res.body.bot_cannot_post, {
        at: Math.floor(at.getTime() / 1000),
        reason: 'Forbidden: bot was kicked from the group chat',
    });
    // only the creator
    assert.equal((await status(ALICE)).body.bot_cannot_post, null);
});

itest('a group upgraded to a supergroup: the new chat decides, the economy stays', async () => {
    chain.addJetton(JETTON);
    chain.addPool(OLD);
    const migratedAt = new Date(Date.now() - 86400 * 1000);
    await seed.chat({
        id: OLD,
        creator: CREATOR,
        jetton_master: JETTON,
        // the old group's own flag is stale: the bot posts to the new id
        bot_cannot_post_at: migratedAt,
        bot_cannot_post_reason: 'Bad Request: group chat was upgraded to a supergroup chat',
        migrated_to_chat_id: NEW,
        migrated_at: migratedAt,
        migration_needs_review: true,
    });
    await seed.chat({ id: NEW, migrated_from_chat_id: OLD });
    let res = await status();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.migrated, { to_chat_id: NEW, at: Math.floor(migratedAt.getTime() / 1000), needs_review: true });
    assert.equal(res.body.bot_cannot_post, null);

    await (await h.getCollection('chats')).updateOne(
        { id: NEW },
        { $set: { bot_cannot_post_at: new Date(), bot_cannot_post_reason: 'Forbidden: bot is not a member of the supergroup chat' } },
    );
    res = await status();
    assert.equal(res.body.bot_cannot_post.reason, 'Forbidden: bot is not a member of the supergroup chat');
});
