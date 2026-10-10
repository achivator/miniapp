# Deploying the mini app to Coolify

`master` is production. A merged pull request reaches users like this:

1. GitHub Actions (`.github/workflows/ci.yml`) runs lint, tests and `next build`.
2. Only if they pass, the `deploy` job asks Coolify to deploy the new commit
   and waits for the result. The job fails if Coolify's build or rollout fails,
   so a red `deploy` job on `master` means production still runs the previous
   version.

Pull requests run step 1 only.

## One-time setup in Coolify

1. **Resource**: New Resource → Application → this GitHub repository
   (through the Coolify GitHub App, or as a public repository), branch
   `master`, build pack **Nixpacks**. Nixpacks takes the Node version from
   `engines.node` in `package.json` (22.x, the same field CI reads) and runs
   `npm run build` / `npm run start`. Ports Exposes: `3000`.
2. **Domain**: `https://achivator.cc`. The domain is baked into the code: the
   TON Connect manifest URL (`src/components/AppShell.js`),
   `public/ton-connect.json`, `metadataBase` and the NFT metadata in
   `public/metadata`. BotFather's Mini App URL for `@achivator_bot` must point
   to it too.
3. **Turn Auto Deploy off** (Configuration → Advanced → Auto Deploy).
   Otherwise Coolify deploys every push to `master` as soon as it happens,
   before CI has run, and the test gate does nothing.
4. **Environment variables**: see `.env.example` for what each one means.
   - Runtime: `MONGODB_URI`, `TELEGRAM_BOT_TOKEN`, `BACKEND_SECRET`,
     `MASTER_ADDRESS`, `LEGACY_MASTER_ADDRESSES` (after a master redeploy, the
     replaced ones), `TONCENTER_URL`, `TONCENTER_API_KEY`,
     `MATURATION_DAYS`, `ACHIEVEMENT_REGISTRY`, `ACHIEVEMENT_TEMPLATES`,
     `IPFS_GATEWAY`.
   - Subscriptions in Telegram Stars: `SUBSCRIPTIONS_ENABLED`,
     `TRIAL_DAYS`, `GRACE_DAYS` (the same values as the bot) and
     `SUBSCRIPTION_TIERS`. `TELEGRAM_BOT_TOKEN` must be the bot's own token:
     Telegram sends the payment to the bot that created the invoice.
   - Tick **"Is Build Variable?"** for `NEXT_PUBLIC_MASTER_ADDRESS`,
     `NEXT_PUBLIC_TON_NETWORK`, `JETTONS_PER_POINT`,
     `SUBSCRIPTIONS_ENABLED`, `TRIAL_DAYS`, `SUBSCRIPTION_TIERS` and, for
     PostHog analytics, `NEXT_PUBLIC_POSTHOG_KEY` (and
     `NEXT_PUBLIC_POSTHOG_HOST` if set). The
     `NEXT_PUBLIC_*` values are inlined into the browser bundle, and the
     landing page is prerendered at build time with the rate, network and
     subscription prices. Without the tick the landing page shows the defaults from the
     code, whatever the runtime says.
   - Never set `DEV_TELEGRAM_USER_ID` in production. `next start` runs with
     `NODE_ENV=production`, which disables it anyway.
5. **MongoDB**: the mini app and the bot share one database
   (`achivator_bot`). Use the same `MONGODB_URI` in both resources. With a
   Coolify-managed MongoDB, use its internal URL and put both applications in
   the same project/network.
6. **Health check** (optional): `GET /` returns 200.

## One-time setup in GitHub

In the repository settings, Environments → `production` (created by the
first run of the `deploy` job, or create it by hand):

| Kind     | Name               | Value                                                                              |
| -------- | ------------------ | ---------------------------------------------------------------------------------- |
| Variable | `COOLIFY_URL`      | Base URL of the Coolify instance, e.g. `https://coolify.example.com`                |
| Variable | `COOLIFY_APP_UUID` | The application's UUID (in its Coolify URL, or Configuration → General)             |
| Secret   | `COOLIFY_TOKEN`    | Coolify → Keys & Tokens → API tokens, with the `deploy` permission                  |

Until all three are set, the `deploy` job only prints a warning and passes,
so merges never fail on missing deployment config.

The Coolify API must be reachable from GitHub-hosted runners. If the
instance is only reachable over a VPN, use a self-hosted runner or open the
API to the internet.

## Rollback

Coolify keeps the previous images: Deployments → pick an earlier one →
Redeploy/Rollback. Reverting the commit on `master` also works: CI then
deploys the revert like any other merge.

## TON Site (achivator.ton)

`achivator.ton` serves the same site as `https://achivator.cc` inside the TON
network: Telegram opens `.ton` links in its in-app browser through its own
TON proxy, Tonkeeper and TON Proxy users can open it too. It is the landing,
not the Mini App: Telegram passes `tgWebAppData` only to a launch from the
bot, so `/` shows the web start screen and its "Open in Telegram" button.

`deploy/tonsite` runs
[tonutils-reverse-proxy](https://github.com/tonutils/reverse-proxy), pinned
to a release in its `Dockerfile`. It takes RLDP-HTTP requests on a UDP port
and forwards them, with `Host: achivator.ton`, to Coolify's Traefik, which
routes them to this application like any other request.

1. **This application**: add `http://achivator.ton` to Domains, after
   `https://achivator.cc` (comma-separated). `http://`, so Coolify does not
   ask Let's Encrypt for a certificate it can never get. To check the route on
   the server: `curl -H 'Host: achivator.ton' http://127.0.0.1/` returns the
   start page.
2. **Resource**: New Resource → Docker Compose → this repository, branch
   `master`, base directory `/deploy/tonsite`, `docker-compose.yml`.
   Variables:
   - `EXTERNAL_IP`: the server's public IPv4. A TON Site needs a public
     ("white") IP.
   - `LISTEN_PORT` (optional, default `13333`): the UDP port, the same inside
     the container and outside.
   The compose file joins the external `coolify` network to reach
   `coolify-proxy` (Traefik); `PROXY_PASS` overrides the target.
3. **Firewall**: inbound UDP on `LISTEN_PORT` must reach the server. Coolify
   has no firewall setting: Docker publishes the port from `ports` itself
   (`docker ps` shows `0.0.0.0:13333->13333/udp`) and its rules bypass
   `ufw`, so what usually blocks it is the cloud provider's firewall (Hetzner
   Cloud Firewall, AWS security group, DigitalOcean Cloud Firewall…): add an
   inbound rule UDP 13333 from any address. Outbound TCP/UDP must be open
   (DHT).
4. **Link the domain** (once): deploy; the log shows
   `Server's ADNL address ADNL_address=…` and then `Starting server`. On
   dns.ton.org, connect the wallet that owns `achivator.ton`, open the domain,
   paste that address into **Site** and save (one transaction).
5. **Check**: send `achivator.ton` in a Telegram chat and open it. Coolify
   shows "DNS mismatch" for `http://achivator.ton`: it checks the ordinary
   DNS, where `.ton` does not exist. Ignore it.

Without requests in the log there is no telling whether any reached the
proxy: set `PROXY_DEBUG=true` on the resource and restart it to log every
RLDP-HTTP request and connection. A `502` page from `nginx` in Telegram is
Telegram's TON gateway failing to reach the proxy.

The compose file runs the proxy without its `-domain` flag on purpose. That
check reads the record from public liteservers before the proxy starts
serving and retries until it gets an answer; on a busy network they often
lack the newest shard block (`code 651 … is not in db (possibly out of
sync)`), so the proxy never served. It also read the owner as `NONE`.

The site's identity is the ADNL key in `config.json` on the `tonsite-data`
volume. Back it up: a lost key means a new ADNL address, the domain points
at the old one, and step 4 has to be repeated with the new address. The key can also live in Coolify as `PRIVATE_KEY` (the
`private_key` value of `config.json`, base64), which then wins over the file.

Renew `achivator.ton` at least once a year (Renew on dns.ton.org with the
owner wallet): an expired domain resolves nothing and goes back to auction.
