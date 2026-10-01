const { getCollection } = require('./mongo');

// A chat's two ids (the bot's index.mjs, "Group -> supergroup migration").
// When Telegram upgrades a group to a supergroup, the chat gets a new id and
// the old one is dead. The bot keeps the chat's economy under the OLD id for
// good, because the chat's TON pool is derived on-chain from it and every
// voucher carries it:
//   - the economy id is the `chat_id` of every collection, the chat document
//     (`chats.id`) with the chat's settings, the id of the pool, of vouchers
//     and of the mini app's URLs (/deposit/<id>, /rating/<id>);
//   - the telegram id is where Telegram knows the chat now: every Bot API
//     call that takes a chat id (membership, admin rights, member names,
//     counts) goes there.
// The bot writes `telegram_chat_id` (and `migrated_to_chat_id`) on the old
// chat's document and `economy_chat_id` on the supergroup's own document,
// which is an alias and nothing else. `migrated_to_chat_id` alone is a move
// Telegram confirmed that an operator still has to review (the supergroup
// had money of its own): the economy stays put, but Telegram only answers
// for the supergroup.

// The id to give the Bot API for this chat document.
function telegramChatId(chat) {
    return chat?.telegram_chat_id ?? chat?.migrated_to_chat_id ?? chat?.id ?? null;
}

// The economy id a chat document stands for: its own, or for a supergroup's
// alias the old group's.
function economyChatIdOf(chat) {
    return Number.isSafeInteger(chat?.economy_chat_id) ? chat.economy_chat_id : chat?.id ?? null;
}

// The economy id of a chat id from a request: a link made in the supergroup
// (or typed by hand) carries the new id, whose document points at the
// economy. Anything else, unknown ids included, is returned as it is, so
// routes answer for it as before (404, 403). Vouchers and every database key
// must use what this returns.
async function resolveEconomyChatId(chatId, chats = null) {
    if (!Number.isSafeInteger(chatId)) return chatId;
    const col = chats || (await getCollection('chats'));
    const doc = await col.findOne({ id: chatId }, { projection: { _id: 0, id: 1, economy_chat_id: 1 } });
    return doc ? economyChatIdOf(doc) : chatId;
}

module.exports = { telegramChatId, economyChatIdOf, resolveEconomyChatId };
