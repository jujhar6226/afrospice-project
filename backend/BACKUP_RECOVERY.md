# AfroSpice Backup And Recovery

## Backup verification

Run:

```powershell
npm.cmd run verify:backup
npm.cmd run verify:restore
```

What it checks:

- backup snapshot generation works
- snapshot timestamp is valid
- settings payload exists
- snapshot collection lengths match live storage counts
- restore drill can rehydrate the snapshot into a temporary database and match expected counts

## Manual backup export

Authenticated owners and managers can export a JSON backup from:

- `GET /api/system/backup`

The exported file includes:

- settings
- roles
- suppliers
- customers
- products
- users
- sales
- purchase orders
- inventory movements
- cycle counts

## Recovery expectations

- Recovery should be performed into a controlled environment first
- Always validate counts after restore with:

```powershell
npm.cmd run verify:runtime
npm.cmd run verify:transactions
npm.cmd run verify:backup
npm.cmd run verify:restore
```

- Before switching traffic, verify sign-in, inventory reads, a sale, and a refund flow

## Operational note

The current system provides verified snapshot export. A full automated restore command is not yet implemented and should be done as a deliberate operator-led recovery procedure.
