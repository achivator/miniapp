// Unit tests for a chat's two ids (src/lib/chat-ids.js): the economy id
// every database key, pool and voucher uses, and the telegram id every Bot
// API call takes, after a group was upgraded to a supergroup.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { economyChatIdOf, resolveEconomyChatId, telegramChatId } = require('../src/lib/chat-ids');

const OLD = -4001;
const NEW = -1004001;

// a stand-in for the chats collection: findOne by id
function chatsOf(...docs) {
    const calls = [];
    return {
        calls,
        async findOne(filter) {
            calls.push(filter);
            return docs.find((d) => d.id === filter.id) ?? null;
        },
    };
}

test('telegramChatId: the supergroup once the alias is active, else the chat itself', () => {
    assert.equal(telegramChatId({ id: OLD }), OLD);
    assert.equal(telegramChatId({ id: OLD, telegram_chat_id: NEW, migrated_to_chat_id: NEW }), NEW);
    // a move an operator still has to review: Telegram only answers there
    assert.equal(telegramChatId({ id: OLD, migrated_to_chat_id: NEW, migration_needs_review: true }), NEW);
    assert.equal(telegramChatId({ id: OLD, telegram_chat_id: NEW, migrated_to_chat_id: -1 }), NEW);
    assert.equal(telegramChatId(null), null);
});

test('economyChatIdOf: the alias points at the old group', () => {
    assert.equal(economyChatIdOf({ id: NEW, economy_chat_id: OLD, migrated_from_chat_id: OLD }), OLD);
    assert.equal(economyChatIdOf({ id: OLD, telegram_chat_id: NEW }), OLD);
    // migrated_from_chat_id alone (no alias: an operator reviews it) is not one
    assert.equal(economyChatIdOf({ id: NEW, migrated_from_chat_id: OLD }), NEW);
    assert.equal(economyChatIdOf({ id: NEW, economy_chat_id: 'x' }), NEW);
    assert.equal(economyChatIdOf(null), null);
});

test('resolveEconomyChatId: a supergroup id resolves, anything else stays', async () => {
    const chats = chatsOf(
        { id: OLD, telegram_chat_id: NEW },
        { id: NEW, economy_chat_id: OLD, migrated_from_chat_id: OLD },
        { id: -4002 },
    );
    assert.equal(await resolveEconomyChatId(NEW, chats), OLD);
    assert.equal(await resolveEconomyChatId(OLD, chats), OLD);
    assert.equal(await resolveEconomyChatId(-4002, chats), -4002);
    // unknown: left to the route (404, 403)
    assert.equal(await resolveEconomyChatId(-4999, chats), -4999);
    // no lookup for what is not a chat id
    assert.ok(Number.isNaN(await resolveEconomyChatId(NaN, chats)));
    assert.equal(chats.calls.length, 4);
});
