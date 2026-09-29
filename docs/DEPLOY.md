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
     `MASTER_ADDRESS`, `TONCENTER_URL`, `TONCENTER_API_KEY`,
     `MATURATION_DAYS`, `ACHIEVEMENT_REGISTRY`, `ACHIEVEMENT_TEMPLATES`,
     `IPFS_GATEWAY`.
   - Tick **"Is Build Variable?"** for `NEXT_PUBLIC_MASTER_ADDRESS`,
     `NEXT_PUBLIC_TON_NETWORK`, `JETTONS_PER_POINT` and `FEE_TIERS`. The
     `NEXT_PUBLIC_*` values are inlined into the browser bundle, and the
     landing page is prerendered at build time with the rate, fee tiers and
     network. Without the tick the landing page shows the defaults from the
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
