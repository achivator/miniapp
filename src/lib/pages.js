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

// Every file the app serves at a path with a dot: public/ and the metadata
// routes of src/app (favicon.ico, robots.js -> /robots.txt, sitemap.js ->
// /sitemap.xml). The middleware serves the styled 404 for any other dotted
// path (/foo.txt, /wp-login.php), so a file missing here would answer 404:
// test/pages.test.js checks this list against public/ and src/app.
const FILES = [
    /^\/favicon\.ico$/,
    /^\/robots\.txt$/,
    /^\/sitemap\.xml$/,
    /^\/ton-connect\.json$/,
    /^\/ton-logo\.png$/,
    /^\/(next|vercel)\.svg$/,
    /^\/(achievements|brand|metadata)\//,
];

function isFile(pathname) {
    return FILES.some((file) => file.test(pathname));
}

module.exports = { PAGES, FILES, isPage, isFile };
