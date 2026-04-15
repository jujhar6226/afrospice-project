# AfroSpice Deployment Readiness

## Required production inputs

Use [`src/.env.example`](C:/Users/regan/Downloads/afrospice/backend/src/.env.example) as the starting template.

Minimum production settings:

- `NODE_ENV=production`
- `MONGO_URI` pointing to the production MongoDB cluster
- `FRONTEND_ORIGIN` set to the real web app origin
- `PUBLIC_BASE_URL` set to the real API origin over `https://`
- `TRUST_PROXY=1` when TLS is terminated at a reverse proxy or load balancer
- `ENFORCE_HTTPS=true`
- `JWT_SECRET` with at least 32 characters
- `AUTH_COOKIE_SECURE=true`
- `BOOTSTRAP_SAMPLE_DATA=false`

## Pre-release checks

Run these from the repository root:

```powershell
npm.cmd run verify:runtime
npm.cmd run verify:transactions
npm.cmd run verify:readiness
```

Expected result:

- `verify:runtime` should report `PASS`
- `verify:transactions` should confirm native transaction support
- `verify:readiness` should report `ready` before production release

## Operational expectations

- Deploy the backend behind HTTPS
- Keep MongoDB on a replica set so sales, refunds, receiving, and cycle counts use native transactions
- Do not enable `DISABLE_AUTH` outside local development
- Do not deploy with localhost origins
- Treat the `/api/system/readiness` endpoint as the release gate for orchestrators and smoke checks

## Post-deploy checks

1. Load `/api/system/health`
2. Load `/api/system/readiness`
3. Sign in with a production staff account
4. Verify `/api/auth/me` succeeds through the deployed frontend
5. Confirm a sale, refund, and inventory movement write correctly
