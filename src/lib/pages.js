// Every page route of the app, as path patterns. The middleware serves the
// styled 404 (status 404) for any other path, so a page route missing here
// would answer 404 in production: test/pages.test.js checks this list
// against the page.js files under src/app.
const PAGES = [
    /^\/$/,
    /^\/help$/,
    /^\/(ru|en)(\/help)?$/,
    /^\/deposit\/[^/]+(\/members(\/[^/]+)?)?$/,
    /^\/achievement\/[^/]+$/,
];

function isPage(pathname) {
    return PAGES.some((page) => page.test(pathname));
}

module.exports = { PAGES, isPage };
