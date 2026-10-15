# Distributed Wagering Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a multi-instance-safe NestJS wagering processor with exact money, immutable ledger, persistent idempotency, transactional inbox/outbox, SQS recovery, and real concurrency tests.

**Architecture:** A modular NestJS monolith keeps domain types framework-independent and routes HTTP and SQS requests through the same transactional application use case. PostgreSQL is the consistency authority; wallet-scoped pessimistic locking and database constraints protect invariants, while persistent inbox/outbox tables provide at-least-once processing and publication.

**Tech Stack:** Bun 1.x, TypeScript strict, NestJS, MikroORM, PostgreSQL, decimal.js, AWS SDK SQS, LocalStack, Docker Compose, Bun test.

**Spec:** `docs/superpowers/specs/2026-10-15-distributed-wagering-processor-design.md`

## Global Constraints

- Runtime, package manager, and test runner must be Bun 1.x.
- Monetary amounts must never pass through JavaScript `number`, `float`, or `double`; contracts use fixed-scale decimal strings.
- PostgreSQL, not process memory or SQS ordering, enforces final consistency and idempotency.
- TypeScript runs in strict mode and domain code imports neither NestJS nor ORM decorators.
- Every balance mutation, ledger entry, inbox completion, and outbox insertion for one request commits atomically.
- The system must remain correct with at least three application instances.
- Migrations are versioned and reversible; required uniqueness, immutability, and non-negativity rules exist in the schema.
- New behavior follows red-green-refactor TDD and is committed in independently testable increments.
- Authentication is represented only by a documented no-op extension point until all scored requirements are complete.

## Review Focus

- Concurrent first delivery of the same idempotency key must resolve through a database constraint and return one stable result; Task 5 adds the parallel integration test.
- A duplicate key or inbox message with a different payload hash must fail permanently without changing wallet state; Tasks 5 and 7 test both paths.
- A crash after commit but before SQS acknowledgement/publication bookkeeping must redeliver safely; Tasks 7 and 8 test both recovery windows.
- Reversal validation must include provider, player, wallet, currency, round, amount, kind, and prior reversal checks; Tasks 6 and 9 exercise each mismatch.
- Decimal values returned by PostgreSQL must remain strings through mapping and reconciliation; Tasks 4 and 10 test exact high-value and fractional cases.

---

### Task 1: Project foundation and executable test harness

**Files:**
- Create: `package.json`
- Create: `bun.lock`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `nest-cli.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/main.ts`
- Create: `src/app.module.ts`
- Create: `src/health/health.controller.ts`
- Create: `test/health/health.e2e-spec.ts`
- Create: `Dockerfile`
- Create: `compose.yaml`

**Interfaces:**
- Produces: Nest application exposing `GET /health/live` and scripts `start:dev`, `build`, `test`, `test:unit`, `test:integration`, and `test:e2e`.
- Produces: Compose services `postgres`, `localstack`, and `app` using configurable ports and health checks.

- [ ] **Step 1: Install or provision Bun 1.x**

Attempt the official Windows Bun installation and verify with `bun --version`. If host installation is unavailable, configure the Bun container target first and run all following Bun commands through Compose.

- [ ] **Step 2: Write the failing liveness end-to-end test**

Create `test/health/health.e2e-spec.ts` asserting that `GET /health/live` returns HTTP 200 and `{ "status": "ok" }` without authentication.

- [ ] **Step 3: Run the liveness test and verify RED**

Run: `bun test test/health/health.e2e-spec.ts`

Expected: FAIL because the Nest application and health controller do not exist.

- [ ] **Step 4: Scaffold the minimal strict NestJS project and Compose infrastructure**

Add exact dependency versions supported by Bun 1.x, configure strict compiler flags, implement only the liveness controller needed by the test, and define PostgreSQL/LocalStack services without application business logic.

- [ ] **Step 5: Verify foundation**

Run: `bun test test/health/health.e2e-spec.ts`

Expected: PASS.

Run: `bun run build`

Expected: exit 0 with no TypeScript errors.

Run: `docker compose config --quiet`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json tsconfig.build.json nest-cli.json .gitignore .env.example src test Dockerfile compose.yaml
git commit -m "chore: bootstrap wagering processor"
```

### Task 2: Exact Money value object

**Files:**
- Create: `src/shared/domain/errors/domain.error.ts`
- Create: `src/shared/domain/money/money.ts`
- Test: `test/unit/shared/domain/money.spec.ts`

**Interfaces:**
- Produces: `Money.from(props: MoneyProps): Money`, `Money.zero(currency: string): Money`, arithmetic/comparison methods, `toJSON(): MoneyProps`, and `toString(): string`.
- Produces: `MoneyProps { amount: string; currency: string }` and stable domain error codes for invalid amount, scale, currency, and currency mismatch.

- [ ] **Step 1: Write failing Money parsing/serialization tests**

Test acceptance of `25.00`, exact two-decimal serialization, BRL normalization, zero creation, and rejection of blank values, `NaN`, `Infinity`, exponent notation, signs where prohibited, and scales other than two.

- [ ] **Step 2: Run parsing tests and verify RED**

Run: `bun test test/unit/shared/domain/money.spec.ts`

Expected: FAIL because `Money` is missing.

- [ ] **Step 3: Implement immutable parsing and serialization**

Use `decimal.js` internally without exposing it in contracts and without converting monetary values to JavaScript `number`.

- [ ] **Step 4: Verify parsing GREEN**

Run: `bun test test/unit/shared/domain/money.spec.ts`

Expected: parsing tests PASS.

- [ ] **Step 5: Write failing arithmetic and comparison tests**

Cover add, subtract, negate, zero/positive/negative, less-than, equality, exact large values, and every cross-currency operation.

- [ ] **Step 6: Implement arithmetic/comparison and verify GREEN**

Run: `bun test test/unit/shared/domain/money.spec.ts`

Expected: all Money tests PASS with no warnings.

- [ ] **Step 7: Commit**

```bash
git add src/shared/domain test/unit/shared/domain/money.spec.ts package.json bun.lock
git commit -m "feat: add exact money value object"
```

### Task 3: Wallet, wager transaction, and immutable ledger domain

**Files:**
- Create: `src/wallet/domain/wallet.ts`
- Create: `src/wallet/domain/wallet-ledger-entry.ts`
- Create: `src/wagering/domain/wager-transaction.ts`
- Create: `src/wagering/domain/wager-rules.ts`
- Create: `src/wagering/domain/failure-code.ts`
- Test: `test/unit/wallet/domain/wallet.spec.ts`
- Test: `test/unit/wallet/domain/wallet-ledger-entry.spec.ts`
- Test: `test/unit/wagering/domain/wager-transaction.spec.ts`
- Test: `test/unit/wagering/domain/wager-rules.spec.ts`

**Interfaces:**
- Consumes: `Money` and `MoneyProps` from Task 2.
- Produces: `Wallet.open`, `Wallet.rehydrate`, `Wallet.debit`, and `Wallet.credit` with version semantics.
- Produces: `WalletLedgerEntry.create/rehydrate` and `LedgerDirection`.
- Produces: `WagerTransaction.create/rehydrate`, terminal transitions, reference queries, ledger direction, transaction kinds/statuses, and stable `FailureCode` values.
- Produces: pure `evaluateWager(request, wallet, reference?)` returning an explicit domain decision without persistence side effects.

- [ ] **Step 1: Write and run failing Wallet tests**

Assert opening at version 1, immutable balance access, debit/credit version increments, insufficient funds, currency mismatch, and that rehydration does not replay transitions.

Run: `bun test test/unit/wallet/domain/wallet.spec.ts`

Expected: FAIL because Wallet is missing.

- [ ] **Step 2: Implement minimal Wallet behavior and verify GREEN**

Run: `bun test test/unit/wallet/domain/wallet.spec.ts`

Expected: PASS.

- [ ] **Step 3: Write and run failing ledger tests**

Assert exact debit/credit arithmetic, rejection of inconsistent before/after balances, structural read-only behavior, and one transaction/wallet identity.

- [ ] **Step 4: Implement ledger entry and verify GREEN**

Run: `bun test test/unit/wallet/domain/wallet-ledger-entry.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write and run failing transaction transition tests**

Assert reference requirements, terminal-state protection, payload matching, LOSS balance behavior, permitted reference kinds, and ledger directions.

- [ ] **Step 6: Implement transaction state machine and verify GREEN**

Run: `bun test test/unit/wagering/domain/wager-transaction.spec.ts`

Expected: PASS.

- [ ] **Step 7: Write and run failing wager-rule tests**

Cover BET, WIN, LOSS, REFUND, ROLLBACK, all reference identity mismatches, amount mismatch, duplicate reversal, insufficient BET funds, and reversal-caused negative balance.

- [ ] **Step 8: Implement pure wager decisions and run all unit tests**

Run: `bun test test/unit`

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/wallet/domain src/wagering/domain test/unit
git commit -m "feat: model wallet ledger and wager domain"
```

### Task 4: PostgreSQL schema, mappings, and repositories

**Files:**
- Create: `src/database/database.module.ts`
- Create: `src/database/mikro-orm.config.ts`
- Create: `src/database/migrations/Migration202610150001.ts`
- Create: `src/wallet/infrastructure/persistence/wallet.record.ts`
- Create: `src/wallet/infrastructure/persistence/ledger-entry.record.ts`
- Create: `src/wagering/infrastructure/persistence/wager-transaction.record.ts`
- Create: `src/messaging/infrastructure/persistence/inbox-message.record.ts`
- Create: `src/messaging/infrastructure/persistence/outbox-message.record.ts`
- Create: `src/wallet/infrastructure/persistence/wallet.mapper.ts`
- Create: `src/wagering/infrastructure/persistence/wager-transaction.mapper.ts`
- Create: `src/wallet/application/ports/wallet.repository.ts`
- Create: `src/wagering/application/ports/wager-transaction.repository.ts`
- Create: `src/messaging/application/ports/inbox.repository.ts`
- Create: `src/messaging/application/ports/outbox.repository.ts`
- Create: `src/**/infrastructure/persistence/*.repository.ts`
- Test: `test/integration/database/migrations.spec.ts`
- Test: `test/integration/database/mappers.spec.ts`
- Test: `test/integration/database/constraints.spec.ts`

**Interfaces:**
- Consumes: domain factories and states from Tasks 2-3.
- Produces: repository ports supporting lookup by internal ID, provider/external ID, and idempotency key; wallet `findOneForUpdate`; immutable ledger append/query; inbox receive/complete; outbox enqueue/claim/update.
- Produces: `TransactionRunner.run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Start PostgreSQL and write failing migration tests**

Run: `docker compose up -d postgres`

Assert migrations apply/revert/apply and inspect required unique, check, foreign-key, and ledger UPDATE/DELETE trigger protections.

- [ ] **Step 2: Run migration tests and verify RED**

Run: `bun test test/integration/database/migrations.spec.ts`

Expected: FAIL because configuration and migrations are missing.

- [ ] **Step 3: Implement schema and migration**

Use PostgreSQL `numeric(...,2)` for money and map decimal columns as strings. Add pending-reference attempts/next-attempt fields and original-result balance snapshot fields.

- [ ] **Step 4: Verify migration GREEN**

Run: `bun test test/integration/database/migrations.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing mapper/repository/constraint tests**

Exercise exact high monetary values, two decimals, duplicate wallet, negative balance, duplicate transaction identities, duplicate ledger, inbox uniqueness, and attempted ledger mutation/deletion.

- [ ] **Step 6: Implement records, mappers, and repositories**

Keep ORM records infrastructure-only and rehydrate domain types explicitly.

- [ ] **Step 7: Run database integration suite**

Run: `bun test test/integration/database`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/database src/wallet/application/ports src/wallet/infrastructure src/wagering/application/ports src/wagering/infrastructure src/messaging test/integration/database
git commit -m "feat: persist financial domain with database constraints"
```

### Task 5: Wallet creation, idempotent wagering use case, and HTTP API

**Files:**
- Create: `src/shared/application/canonical-json.ts`
- Create: `src/shared/application/clock.ts`
- Create: `src/shared/application/id-generator.ts`
- Create: `src/wallet/application/create-wallet.use-case.ts`
- Create: `src/wagering/application/process-wager.use-case.ts`
- Create: `src/wallet/interface/http/wallet.controller.ts`
- Create: `src/wagering/interface/http/wagering.controller.ts`
- Create: `src/**/interface/http/*.dto.ts`
- Create: `src/shared/interface/http/domain-exception.filter.ts`
- Test: `test/unit/shared/application/canonical-json.spec.ts`
- Test: `test/integration/application/create-wallet.spec.ts`
- Test: `test/integration/application/process-wager.spec.ts`
- Test: `test/e2e/http/wagering.e2e-spec.ts`

**Interfaces:**
- Consumes: repository and transaction ports from Task 4 and domain decisions from Task 3.
- Produces: `CreateWalletUseCase.execute(command): Promise<WalletResult>`.
- Produces: `ProcessWagerUseCase.execute(command, context): Promise<WagerResult>` shared by HTTP and future SQS adapter.
- Produces: required wallet and wagering HTTP routes with stable error/status mapping.

- [ ] **Step 1: Write failing canonical JSON/hash tests**

Assert recursively sorted keys, stable array order, exclusion of transport metadata, and equal hashes for semantically identical business payloads.

- [ ] **Step 2: Implement canonicalization/hash and verify GREEN**

Run: `bun test test/unit/shared/application/canonical-json.spec.ts`

Expected: PASS.

- [ ] **Step 3: Write failing wallet-creation integration tests**

Assert atomic wallet/OPENING/credit-ledger creation, zero opening behavior, duplicate conflict, and rollback without partial rows.

- [ ] **Step 4: Implement wallet creation and verify GREEN**

Run: `bun test test/integration/application/create-wallet.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing wagering integration tests**

Cover every operation kind, atomic wallet/transaction/ledger/outbox writes, exact original-result replay, divergent payload conflict, and simultaneous first delivery of one key.

- [ ] **Step 6: Implement transactional wagering use case**

Acquire the wallet row lock before balance-sensitive evaluation. Resolve uniqueness races by reloading and comparing the committed hash; never retry a domain mutation blindly.

- [ ] **Step 7: Verify application integration GREEN**

Run: `bun test test/integration/application`

Expected: PASS.

- [ ] **Step 8: Write failing HTTP end-to-end tests**

Cover required endpoints, required idempotency header, DTO rejection, 202 pending, 409 conflicts, 422 domain rejection, and stable replay response.

- [ ] **Step 9: Implement controllers/DTOs/filter and verify GREEN**

Run: `bun test test/e2e/http`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared src/wallet/application src/wallet/interface src/wagering/application src/wagering/interface test/unit/shared/application test/integration/application test/e2e/http
git commit -m "feat: expose atomic idempotent wagering API"
```

### Task 6: Integration events and transactional outbox enqueueing

**Files:**
- Create: `src/messaging/domain/integration-event.ts`
- Create: `src/messaging/domain/events/*.event.ts`
- Create: `src/messaging/domain/outbox-message.ts`
- Modify: `src/wallet/application/create-wallet.use-case.ts`
- Modify: `src/wagering/application/process-wager.use-case.ts`
- Test: `test/unit/messaging/domain/integration-event.spec.ts`
- Test: `test/unit/messaging/domain/outbox-message.spec.ts`
- Modify: `test/integration/application/*.spec.ts`

**Interfaces:**
- Produces: abstract `IntegrationEvent<T>.toJSON()` and concrete processed, rejected, balance-changed, and pending-reference event types.
- Produces: `OutboxMessage.enqueue/rehydrate/isPending/isDue/markPublished/scheduleRetry`.
- Produces: stable event IDs, correlation/causation metadata, and JSON payloads containing `MoneyProps`, never domain `Money` instances.

- [ ] **Step 1: Write and run failing event-envelope tests**

Assert concrete type/version ownership, ISO dates, immutable data, stable IDs, and JSON-safe MoneyProps.

- [ ] **Step 2: Implement events and verify GREEN**

Run: `bun test test/unit/messaging/domain/integration-event.spec.ts`

Expected: PASS.

- [ ] **Step 3: Write and run failing outbox state tests**

Use a fixed Clock to assert due checks, publishing, attempt increments, capped exponential backoff, and terminal published behavior.

- [ ] **Step 4: Implement OutboxMessage and verify GREEN**

Run: `bun test test/unit/messaging/domain/outbox-message.spec.ts`

Expected: PASS.

- [ ] **Step 5: Extend failing application tests for exact event sets**

Assert processed/rejected/pending events and assert `WalletBalanceChanged` exists only for actual balance changes.

- [ ] **Step 6: Enqueue events inside existing SQL transactions and verify suite**

Run: `bun test test/unit test/integration/application`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/messaging/domain src/wallet/application src/wagering/application test
git commit -m "feat: enqueue transactional integration events"
```

### Task 7: SQS consumer and persistent inbox

**Files:**
- Create: `src/messaging/domain/inbox-message.ts`
- Create: `src/messaging/application/consume-wager-message.use-case.ts`
- Create: `src/messaging/infrastructure/sqs/sqs.client.ts`
- Create: `src/messaging/infrastructure/sqs/wager-consumer.worker.ts`
- Create: `src/messaging/infrastructure/sqs/error-classifier.ts`
- Create: `scripts/localstack/init-queues.sh`
- Modify: `compose.yaml`
- Test: `test/unit/messaging/domain/inbox-message.spec.ts`
- Test: `test/integration/messaging/inbox-redelivery.spec.ts`
- Test: `test/integration/messaging/sqs-consumer.spec.ts`

**Interfaces:**
- Consumes: `ProcessWagerUseCase.execute` from Task 5.
- Produces: inbox receive/rehydrate/complete lifecycle and `ConsumeWagerMessageUseCase.execute(envelope)`.
- Produces: worker lifecycle methods `start`, `stopPolling`, and `drain(gracePeriodMs)`.

- [ ] **Step 1: Write failing inbox domain tests, implement, and verify**

Assert completion is one-way, rehydration preserves timestamps, and duplicate completion is an invariant error.

Run: `bun test test/unit/messaging/domain/inbox-message.spec.ts`

Expected after implementation: PASS.

- [ ] **Step 2: Write failing inbox/redelivery integration tests**

Cover inbox/financial/ledger/outbox atomicity, completed duplicate acknowledgement, concurrent duplicate delivery, and duplicate message ID with a divergent payload hash.

- [ ] **Step 3: Implement inbox-aware message use case and verify GREEN**

Run: `bun test test/integration/messaging/inbox-redelivery.spec.ts`

Expected: PASS.

- [ ] **Step 4: Write failing LocalStack consumer tests**

Cover valid consumption, business rejection acknowledgement, transient retry, permanent malformed-message DLQ, retry limit, commit-before-ack crash simulation, and SIGTERM draining.

- [ ] **Step 5: Implement SQS adapter, queue provisioning, and error policy**

Keep provider identity validation in the shared application use case and treat transport envelope validity separately.

- [ ] **Step 6: Run messaging integration suite**

Run: `docker compose up -d postgres localstack`

Run: `bun test test/integration/messaging`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/messaging scripts/localstack compose.yaml test/integration/messaging test/unit/messaging
git commit -m "feat: consume wagers with persistent inbox"
```

### Task 8: Concurrent transactional outbox publisher

**Files:**
- Create: `src/messaging/application/publish-outbox.use-case.ts`
- Create: `src/messaging/infrastructure/sqs/outbox-publisher.worker.ts`
- Modify: `src/messaging/infrastructure/persistence/outbox.repository.ts`
- Test: `test/integration/messaging/outbox-publisher.spec.ts`

**Interfaces:**
- Consumes: outbox repository and SQS client from prior tasks.
- Produces: `PublishOutboxBatchUseCase.execute(now, batchSize): Promise<PublishBatchResult>` using `FOR UPDATE SKIP LOCKED` claims.
- Produces: an outbox worker with scheduled polling and graceful drain.

- [ ] **Step 1: Write failing publisher integration tests**

Cover one publish, two concurrent publishers, publish failure/backoff, outbox lag timestamps, process restart, and crash after SQS publish but before `published_at` update with stable duplicate event ID.

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test test/integration/messaging/outbox-publisher.spec.ts`

Expected: FAIL because publisher behavior is missing.

- [ ] **Step 3: Implement batch claim/publish/update behavior**

Keep database transactions short; never hold a wallet lock while performing network I/O. Preserve at-least-once semantics explicitly.

- [ ] **Step 4: Verify publisher GREEN**

Run: `bun test test/integration/messaging/outbox-publisher.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messaging test/integration/messaging/outbox-publisher.spec.ts
git commit -m "feat: publish outbox safely across instances"
```

### Task 9: Out-of-order reference reprocessing

**Files:**
- Create: `src/wagering/application/reprocess-pending-references.use-case.ts`
- Create: `src/wagering/infrastructure/workers/pending-reference.worker.ts`
- Modify: `src/wagering/infrastructure/persistence/wager-transaction.repository.ts`
- Modify: `src/wagering/domain/wager-transaction.ts`
- Test: `test/unit/wagering/domain/pending-reference.spec.ts`
- Test: `test/integration/wagering/pending-reference-worker.spec.ts`

**Interfaces:**
- Produces: pending-reference attempt/backoff behavior and `ReprocessPendingReferencesUseCase.execute(now, batchSize)`.
- Produces: repository claiming due rows with `FOR UPDATE SKIP LOCKED` and reuse of the same locked wager processing policy.

- [ ] **Step 1: Write failing attempt/backoff/terminal tests**

Assert configurable 10-attempt default, one-hour cap, immutable terminal states, and `REFERENCE_NOT_FOUND` after exhaustion.

- [ ] **Step 2: Implement domain retry metadata and verify GREEN**

Run: `bun test test/unit/wagering/domain/pending-reference.spec.ts`

Expected: PASS.

- [ ] **Step 3: Write failing worker integration tests**

Cover REFUND/ROLLBACK before reference, later convergence, concurrent workers, all reference identity/kind/amount mismatch rejections, prior reversal, and exhausted missing reference event.

- [ ] **Step 4: Implement claim/reprocess worker and verify GREEN**

Run: `bun test test/integration/wagering/pending-reference-worker.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wagering test/unit/wagering/domain/pending-reference.spec.ts test/integration/wagering
git commit -m "feat: recover out-of-order wager references"
```

### Task 10: Queries, reconciliation, health, logs, and metrics

**Files:**
- Create: `src/wallet/application/get-wallet.use-case.ts`
- Create: `src/wallet/application/list-ledger.use-case.ts`
- Create: `src/wallet/application/reconcile-wallet.use-case.ts`
- Create: `src/wagering/application/get-wager-transaction.use-case.ts`
- Create: `src/shared/observability/logger.ts`
- Create: `src/shared/observability/metrics.ts`
- Create: `src/health/readiness.service.ts`
- Modify: `src/health/health.controller.ts`
- Modify: wallet/wager controllers and workers
- Test: `test/integration/wallet/queries-reconciliation.spec.ts`
- Test: `test/e2e/http/queries-health.e2e-spec.ts`
- Test: `test/unit/shared/observability/redaction.spec.ts`

**Interfaces:**
- Produces: all required query/reconciliation endpoints, opaque `(createdAt,id)` ledger cursor, and exact balance comparison.
- Produces: readiness response requiring PostgreSQL and SQS, structured contextual logs, and mandatory metric counters/histograms/gauges.

- [ ] **Step 1: Write failing query/reconciliation tests**

Cover stable cursor ordering with equal timestamps, exact large/fractional balance reconstruction from zero, mismatch signaling without repair, checked-entry count, and transaction lookup variants.

- [ ] **Step 2: Implement queries/reconciliation and verify GREEN**

Run: `bun test test/integration/wallet/queries-reconciliation.spec.ts`

Expected: PASS.

- [ ] **Step 3: Write failing health/observability tests**

Assert open liveness, PostgreSQL/SQS readiness degradation, required correlation fields, financial-payload redaction, and metric changes for status/duplicates/retries/DLQ/locks/outbox lag/latency/reconciliation.

- [ ] **Step 4: Implement health, logger, metrics, and instrumentation**

- [ ] **Step 5: Run HTTP and observability suites**

Run: `bun test test/e2e/http test/unit/shared/observability`

Expected: PASS with no sensitive payload snapshots.

- [ ] **Step 6: Commit**

```bash
git add src test/integration/wallet test/e2e/http test/unit/shared/observability
git commit -m "feat: add reconciliation and operational visibility"
```

### Task 11: Multi-instance concurrency and recovery proof

**Files:**
- Create: `test/concurrency/idempotency.concurrent-spec.ts`
- Create: `test/concurrency/competing-bets.concurrent-spec.ts`
- Create: `test/concurrency/distinct-wallets.concurrent-spec.ts`
- Create: `test/concurrency/multi-instance.concurrent-spec.ts`
- Create: `test/concurrency/crash-recovery.concurrent-spec.ts`
- Create: `test/support/process-harness.ts`
- Create: `scripts/test-concurrency.ps1`
- Modify: `compose.yaml`

**Interfaces:**
- Consumes: complete application, database, and LocalStack flows.
- Produces: repeatable `bun run test:concurrency` proof with at least three isolated application processes/containers.

- [ ] **Step 1: Write concurrency tests against the existing application**

Assert 50 identical bets yield one debit; competing BRL 80.00 bets against BRL 100.00 yield exactly one processed, one insufficient-funds rejection, one debit ledger row, and BRL 20.00; distinct wallets make concurrent progress; three instances preserve the same outcomes.

- [ ] **Step 2: Run concurrency tests and record any RED race**

Run: `bun run test:concurrency`

Expected: tests either PASS immediately from prior design or expose a reproducible race before any fix.

- [ ] **Step 3: For every exposed race, add the smallest failing regression and fix it**

Do not weaken timing/assertions. Fix transaction boundaries, constraints, or lock ordering, then rerun the exact failing test.

- [ ] **Step 4: Add restart/crash recovery scenarios**

Kill a worker after commit/before ack, restart services with pending outbox and reference records, and verify eventual processing without duplicated financial effects.

- [ ] **Step 5: Verify final invariant in every scenario**

For every touched wallet assert `wallet.balance == balance reconstructed from ledger` using exact Money arithmetic.

- [ ] **Step 6: Run concurrency suite repeatedly**

Run: `bun run test:concurrency` three consecutive times.

Expected: all runs PASS without flaky retries in the test harness.

- [ ] **Step 7: Commit**

```bash
git add test/concurrency test/support scripts/test-concurrency.ps1 compose.yaml package.json bun.lock
git commit -m "test: prove multi-instance financial consistency"
```

### Task 12: Submission documentation and final verification

**Files:**
- Modify: `README.md`
- Create: `ARCHITECTURE.md`
- Create: `docs/api-examples.http`
- Create: `docs/failure-codes.md`

**Interfaces:**
- Produces: reproducible setup/test/demo commands, architecture rationale/trade-offs, Mermaid-free text diagrams, failure taxonomy, authentication extension design, operational limits, and known limitations.

- [ ] **Step 1: Write documentation from verified behavior**

Document Bun/container setup, Compose lifecycle, migrations, API/SQS examples, all test commands, lock strategy, schema constraints, canonical hashing, failure classification, pending-reference policy, inbox/outbox delivery semantics, shutdown behavior, and observability.

- [ ] **Step 2: Perform clean-start verification**

Run: `docker compose down --volumes`

Run: `docker compose up -d --build`

Run: `docker compose ps`

Expected: PostgreSQL and LocalStack healthy; application instances become ready.

- [ ] **Step 3: Run every verification command**

Run: `bun run build`

Run: `bun run test:unit`

Run: `bun run test:integration`

Run: `bun run test:e2e`

Run: `bun run test:concurrency`

Expected: all commands exit 0 with no ignored failures or warnings that compromise correctness.

- [ ] **Step 4: Validate migrations both directions on a disposable database**

Run the documented migration up/down/up sequence and confirm the schema/trigger tests still pass.

- [ ] **Step 5: Review repository for forbidden patterns and secrets**

Run searches for monetary `number`, float/double schema columns, pre-commit event publication, mutable ledger operations, hard-coded credentials, untracked `.env` files, skipped tests, and TODO/TBD markers. Resolve or explicitly document every finding.

- [ ] **Step 6: Commit**

```bash
git add README.md ARCHITECTURE.md docs
git commit -m "docs: finalize wagering processor submission"
```

- [ ] **Step 7: Final branch review**

Inspect `git status`, `git log`, and the complete diff from the initial architecture commit. Report exact verification commands and results; do not claim completion if any mandatory suite is red.
