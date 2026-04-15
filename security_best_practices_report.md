# AfroSpice Backend Audit Report

Date: 2026-03-26
Scope: `backend/` application code, Mongo runtime configuration, route/controller/service/data-layer boundaries, reporting, AI grounding, and operational security posture.

## Executive Summary

MongoDB is live and reachable on `mongodb://127.0.0.1:27017/afrospice`, but the current backend is not yet production-grade. The most serious issues are:

1. the live Mongo database is being auto-populated from seeded sample business data,
2. stock-changing workflows are not protected by MongoDB transactions,
3. several controllers bypass the intended controller -> service -> repository architecture,
4. validation coverage is incomplete for multiple operational workflows,
5. analytics and AI are built from whole-process cache snapshots instead of repository-scoped Mongo queries.

This means the system can appear to work while still carrying real integrity, maintainability, and security risk. The next step should be a controlled backend rebuild around explicit repositories, Mongo transactions, proper validators, and removal of runtime seeding from the main application path.

## Runtime Verification

I verified the running backend against Mongo on 2026-03-26 with:

`cd backend && npm run verify:runtime`

Observed result:

- Mongo host: `127.0.0.1`
- Mongo port: `27017`
- Database: `afrospice`
- Connection state: `connected`
- Core collections contain records
- AI mode: `grounded-assistant`
- External provider: not configured

Observed collection counts:

- roles: 4
- suppliers: 18
- customers: 6
- products: 22
- users: 5
- sales: 24
- purchaseOrders: 19
- inventoryMovements: 96
- cycleCounts: 4
- auditLogs: 0

The connection is real. The data quality is not yet trustworthy because of the seed/bootstrap behavior described below.

## Critical Findings

### AFRO-001: Runtime seed data contaminates the live Mongo database

Severity: Critical

Location:

- `backend/src/config/runtime.js:53-60`
- `backend/src/data/store.mongo.js:478-499`
- `backend/src/data/seedData.js:1-134`

Evidence:

- `runtime.js` enables `bootstrapSampleData` by default outside production.
- `store.mongo.js` calls `ensureBootstrapSeedData()` during initialization.
- `seedData.js` contains hard-coded products, users, PINs, and sales such as `ADMIN001 / 1234`.

Impact:

An empty Mongo database is automatically filled with fake products, fake staff, fake credentials, and fake sales. This directly violates the requirement for real business data and can corrupt trust in login, reporting, analytics, AI briefings, and stock movement history.

Fix:

Remove runtime seeding from application startup. Replace it with an explicit one-shot bootstrap CLI that is disabled by default in every environment and never runs during normal app startup.

### AFRO-002: Stock-changing workflows are not protected by MongoDB transactions

Severity: Critical

Location:

- `backend/src/data/store.mongo.js:1862-1997`
- `backend/src/data/store.mongo.js:2000-2137`
- `backend/src/data/store.mongo.js:2272-2403`
- `backend/src/data/store.mongo.js:2462-2574`
- `backend/src/data/store.mongo.js:977-995`

Evidence:

- Sale creation decrements product stock, writes sales, and writes inventory movements as separate operations.
- Sale status changes, purchase receiving, and cycle count completion also update multiple collections in sequence.
- The code uses an in-process `writeQueue`, but there is no `mongoose.startSession()` transaction boundary.

Impact:

If the process crashes mid-write, if Mongo acknowledges some operations but not others, or if the app ever runs in multiple instances, stock, sales, purchase receipts, and movement trails can diverge. Manual rollback logic is not equivalent to a database transaction.

Fix:

Move all inventory-affecting workflows into repository methods that use MongoDB transactions and idempotent business commands. The write queue can remain as a local throttle if useful, but it must not be the integrity mechanism.

## High Findings

### AFRO-003: Clean architecture is broken in user and reporting flows

Severity: High

Location:

- `backend/src/controllers/userController.js:1-885`
- `backend/src/controllers/reportController.js:1-275`

Evidence:

- `userController.js` imports `bcryptjs` and `../data/storeRuntime` directly and contains validation, business rules, persistence calls, export formatting, and response handling.
- `reportController.js` imports `../data/storeRuntime` directly and mixes controller responsibilities with analytics composition and CSV export logic.

Impact:

The codebase does not consistently follow `routes -> controllers -> services -> repositories`. That makes validation inconsistent, weakens auditability, and makes future fixes risky because business rules are scattered through controllers.

Fix:

Split `userController` into thin controller methods backed by a dedicated `userService` and repository layer. Move report export/query assembly into report services and repositories.

### AFRO-004: Validation coverage is incomplete for operational workflows

Severity: High

Location:

- `backend/src/validation/` currently contains only `authValidators.js`, `productValidators.js`, `salesValidators.js`, and `settingsValidators.js`
- `backend/src/services/purchaseOrderService.js:10-18,45-103,171-243`
- `backend/src/services/cycleCountService.js:6-20,42-145`
- `backend/src/controllers/reportController.js:6-8,208-221`
- `backend/src/controllers/userController.js:254-385,466-716,846-881`

Evidence:

- Purchase order, cycle count, report, and user flows parse raw request payloads manually.
- Query inputs like `range`, `limit`, and chat history are not consistently validated at the route boundary.
- Large parts of user validation live inside the controller instead of reusable validators.

Impact:

Malformed or malicious requests can reach business logic too easily, produce inconsistent records, and create multiple validation styles across the API surface.

Fix:

Add explicit validators for every route body, params, and query object, and enforce them before controller execution. User, purchase order, cycle count, report, and AI request validators should be first.

### AFRO-005: Analytics and AI depend on whole-process cache snapshots instead of repository-scoped Mongo queries

Severity: High

Location:

- `backend/src/services/analyticsService.js:400-435`
- `backend/src/services/copilotService.js:756-773`
- `backend/src/controllers/reportController.js:28-129`

Evidence:

- `analyticsService.getAnalyticsContext()` pulls full datasets for settings, products, sales, purchase orders, movements, users, customers, suppliers, and cycle counts from `storeRuntime`.
- `copilotService` also reads directly from `storeRuntime` snapshots.

Impact:

Reports and AI outputs are derived from in-memory process snapshots rather than targeted Mongo queries or aggregation pipelines. That hurts scale, makes consistency depend on cache refresh timing, and is not state-of-the-art for a production analytics backend.

Fix:

Rebuild analytics and AI data access around repository query DTOs and Mongo aggregation pipelines. Only fetch the slices required for a given report or AI prompt.

### AFRO-006: Customer and supplier API layers are missing

Severity: High

Location:

- `backend/src/app.js:91-99`
- `backend/src/routes/` does not include `customerRoutes.js` or `supplierRoutes.js`
- `backend/src/services/` does not include customer or supplier services

Evidence:

- Customers and suppliers exist as data concepts and models, but there are no dedicated controller/service/route layers for them.
- The backend only mounts auth, settings, products, sales, reports, users, purchase orders, cycle counts, and system routes.

Impact:

The backend cannot fully support real customer and supplier pages or CRUD/report workflows without frontend workarounds or hidden access paths. This is a structural gap against the stated product scope.

Fix:

Add customer and supplier repositories, services, controllers, validators, and routes before front-end redesign continues.

## Medium Findings

### AFRO-007: Core timestamps are stored as strings instead of Mongo `Date`

Severity: Medium

Location:

- `backend/src/data/models/User.js:43-55`
- `backend/src/data/models/Sale.js:11-34`
- `backend/src/data/models/PurchaseOrder.js:13-34`
- `backend/src/data/models/Product.js:15-16`
- `backend/src/data/models/UserSession.js:10-12`
- `backend/src/data/models/InventoryMovement.js:17`
- similar patterns across the remaining models

Evidence:

Most temporal fields are defined as `type: String` and manually filled with ISO strings.

Impact:

This weakens native date filtering, aggregation, indexing, TTL support, and temporal validation. It also makes the code more error-prone and forces date parsing back into the service layer.

Fix:

Migrate business timestamps to `Date` fields and use Mongoose timestamps where appropriate. Keep presentation formatting out of the persistence model.

### AFRO-008: Error and authorization responses are inconsistent

Severity: Medium

Location:

- `backend/src/middleware/roles.js:1-11`
- `backend/src/controllers/reportController.js:10-25,233-260`
- `backend/src/controllers/userController.js:387-881`

Evidence:

- `roles.js` writes a raw `403` response directly.
- `reportController` uses local `fail()` handling instead of centralized error propagation.
- `userController` contains many local `try/catch` blocks and manual `fail()` responses.

Impact:

The API contract is inconsistent across route families, centralized logging is weakened, and some failures bypass the standard `AppError`/error middleware path.

Fix:

Throw `AppError` from middleware/controllers and let the centralized error middleware handle formatting and logging.

### AFRO-009: Development JWT secret fallback hides configuration problems and invalidates sessions on restart

Severity: Medium

Location:

- `backend/src/config/runtime.js:12-20`

Evidence:

- When `JWT_SECRET` is missing in development, the server generates a fresh random secret each boot.

Impact:

Every backend restart invalidates existing tokens, which looks like intermittent auth failure and makes environment drift harder to diagnose.

Fix:

Require an explicit `JWT_SECRET` in all environments used for real testing, staging, or business operations. Keep auto-generation only for isolated throwaway local debugging, if at all.

## Rebuild Priority

1. Remove runtime seed/bootstrap behavior from the app path and clear demo-derived records from Mongo.
2. Replace `store.mongo.js` monolith workflows with repository methods that use Mongo transactions.
3. Rebuild `user`, `report`, `purchase order`, and `cycle count` flows with real validators and thin controllers.
4. Add customer and supplier API layers.
5. Move analytics and AI grounding to repository-scoped Mongo queries and aggregation pipelines.
6. Migrate temporal fields to `Date`.

## Notes

- This audit covers the repository code and local runtime behavior only.
- TLS termination, reverse proxy config, backup policy, and infrastructure secrets management were not visible in the application code and still need separate deployment review.
