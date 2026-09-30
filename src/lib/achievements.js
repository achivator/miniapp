// Display names of the achievements. The bot stores an achievement's type as
// an English identifier ("night owl", "over 9000"; telegram-bot/index.mjs,
// giveAchievement) that also names its medal (public/achievements/v1) and its
// NFT metadata (public/metadata/items/v1, whose English names match the ones
// here). The app screens show the name in their language; a type the bot
// gains later without an entry here is shown humanized ("Fresh Type").
const NAMES = {
    // messages
    newbie: ['Новичок', 'Newbie'],
    talkative: ['Болтун', 'Talkative'],
    programmer: ['Программист', 'Programmer'],
    'night owl': ['Ночная сова', 'Night Owl'],
    santa: ['Санта', 'Santa'],
    exclamator: ['Восклицатель', 'Exclamator'],
    'over 9000': ['Больше 9000', 'Over 9000'],
    telescope: ['Телескоп', 'Telescope'],
    voicy: ['Голосистый', 'Voicy'],
    sticker: ['Стикерщик', 'Sticker'],
    // reactions given
    reactive: ['Реактивный', 'Reactive'],
    'sad clown': ['Грустный клоун', 'Sad Clown'],
    'spread the love': ['Сеятель любви', 'Spread the Love'],
    'likes for everyone': ['Лайки всем', 'Likes for Everyone'],
    'fire starter': ['Поджигатель', 'Fire Starter'],
    'poop master': ['Мастер какашек', 'Poop Master'],
    // reactions received
    liked: ['Залайканный', 'Liked'],
    'on fire': ['В огне', 'On Fire'],
    loved: ['Любимчик', 'Loved'],
    clown: ['Клоун', 'Clown'],
    poop: ['Какашка', 'Poop'],
};

// The identifier as a title: "fresh_type" -> "Fresh Type".
function humanize(type) {
    return String(type ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// The name of achievement `type` in `locale` ("ru" or "en").
function achievementName(type, locale) {
    const names = NAMES[String(type ?? '').trim().toLowerCase()];
    if (!names) return humanize(type);
    return locale === 'ru' ? names[0] : names[1];
}

module.exports = { ACHIEVEMENT_NAMES: NAMES, achievementName, humanize };
