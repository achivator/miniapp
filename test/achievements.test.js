// Display names of the achievement types the bot awards (lib/achievements.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ACHIEVEMENT_NAMES, achievementName, humanize } = require('../src/lib/achievements');

test('known types have a name in each language', () => {
    assert.equal(achievementName('night owl', 'ru'), 'Ночная сова');
    assert.equal(achievementName('night owl', 'en'), 'Night Owl');
    assert.equal(achievementName('over 9000', 'ru'), 'Больше 9000');
    for (const [type, [ru, en]] of Object.entries(ACHIEVEMENT_NAMES)) {
        assert.ok(ru && en, type);
        assert.equal(type, type.toLowerCase(), `${type}: keys are lower case`);
        assert.notEqual(ru, en, `${type}: the Russian name is a translation`);
    }
});

test('types are matched regardless of case (the bot stores "Santa")', () => {
    assert.equal(achievementName('Santa', 'ru'), 'Санта');
    assert.equal(achievementName(' Sad Clown ', 'en'), 'Sad Clown');
});

test('unknown types fall back to the humanized identifier in both languages', () => {
    assert.equal(achievementName('code reviewer', 'ru'), 'Code Reviewer');
    assert.equal(achievementName('early_bird-2', 'en'), 'Early Bird 2');
    assert.equal(humanize(undefined), '');
    assert.equal(achievementName(null, 'en'), '');
});

test('every medal artwork has a display name', () => {
    const dir = path.join(__dirname, '..', 'public', 'achievements', 'v1');
    const types = fs.readdirSync(dir).map((file) => path.parse(file).name);
    assert.ok(types.length > 0);
    for (const type of types) assert.ok(ACHIEVEMENT_NAMES[type], `${type} has no entry in src/lib/achievements.js`);
});
