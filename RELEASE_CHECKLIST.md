# AfroSpice Release Checklist

## 1. Production environment

Backend:

- Copy [`backend/src/.env.example`](C:/Users/regan/Downloads/afrospice/backend/src/.env.example)
- Set `NODE_ENV=production`
- Set real values for `MONGO_URI`, `FRONTEND_ORIGIN`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, `JWT_SECRET`
- Keep `AUTH_COOKIE_SECURE=true`
- Keep `BOOTSTRAP_SAMPLE_DATA=false`

Frontend:

- Copy [`frontend/.env.example`](C:/Users/regan/Downloads/afrospice/frontend/.env.example)
- Set `VITE_API_URL` only if the frontend and backend are deployed on different origins

## 2. Release gate

Strict gate:

```powershell
npm.cmd run verify:release
```

Local validation with readiness warnings allowed:

```powershell
npm.cmd run verify:release:local
```

## 3. Backend runtime checks

```powershell
npm.cmd run verify:runtime
npm.cmd run verify:transactions
npm.cmd run verify:readiness
npm.cmd run verify:backup
npm.cmd run verify:restore
```

Expected production outcome:

- `verify:runtime` passes
- `verify:transactions` confirms native transactions
- `verify:readiness` reports `ready`
- `verify:backup` confirms the exported backup snapshot matches live storage counts
- `verify:restore` confirms the backup can be restored into a temporary database and validated

## 4. Live smoke checks

1. `GET /api/system/health`
2. `GET /api/system/readiness`
3. Sign in with a real staff account
4. Confirm `/api/auth/me` works through the deployed frontend
5. Create a sale, refund it, and verify inventory movement/audit trails

## 5. AI posture

- Grounded assistant is always safe to keep enabled
- External AI routing should only be enabled when `OPENAI_API_KEY` is configured intentionally
