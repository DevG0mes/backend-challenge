# Distributed Wagering Processor — Design

## Objective

Build a production-oriented submission for the Jungle Gaming backend challenge in three days. The implementation must prioritize the eliminatory correctness requirements: exact monetary arithmetic, non-negative balances under concurrency, persistent idempotency, an immutable auditable ledger, atomic inbox/outbox persistence, and correctness across multiple application instances.

The work will be delivered incrementally and explained as it evolves so the candidate can understand, test, and defend every architectural decision.

## Scope and priorities

The implementation covers the complete mandatory challenge in this order:

1. Financial domain and invariants.
2. PostgreSQL schema, migrations, and transactional processing.
3. HTTP API and persistent idempotency.
4. SQS ingestion, inbox, retry, and DLQ behavior.
5. Transactional outbox and concurrent publishing.
6. Out-of-order references and scheduled reprocessing.
7. Real concurrency and recovery tests.
8. Observability, health checks, and documentation.

Authentication is deliberately deferred because it does not score. The application will expose an explicit no-op authentication extension point and document the intended OIDC integration. Optional double-entry bookkeeping, OpenTelemetry, dashboards, and load testing are out of scope unless all mandatory behavior is complete early.

## Technology

- Bun 1.x for runtime, package management, scripts, and test execution.
- TypeScript in strict mode.
- NestJS for dependency injection, HTTP, lifecycle, and scheduling.
- MikroORM for persistence, Unit of Work, transactions, and row locking.
- PostgreSQL as the consistency authority.
- AWS SQS-compatible FIFO queues through LocalStack.
- Docker Compose for PostgreSQL, LocalStack, application instances, and test infrastructure.
- A decimal arithmetic library for domain calculations; JavaScript `number` is forbidden for monetary values.

If Bun cannot be installed directly on the Windows host, all required commands remain available in the Bun-based development/application container.

## Architecture

The solution is a modular monolith. It uses one codebase and one PostgreSQL database, while allowing the HTTP server and background workers to run in three or more processes or containers. This avoids unnecessary microservice boundaries while still exercising the distributed consistency requirements.

Modules are organized by business capability:

- `wallet`: wallet creation, balance, ledger queries, and reconciliation.
- `wagering`: submission and processing of BET, WIN, LOSS, REFUND, and ROLLBACK.
- `messaging`: SQS consumption, persistent inbox, transactional outbox, retry, and DLQ.
- `health`: liveness and dependency readiness.
- `shared`: Money, identifiers, time abstraction, canonical JSON hashing, errors, and transaction support.

Each business module separates:

- Domain: framework-independent entities, value objects, rules, and transitions.
- Application: use cases and ports coordinating transactions.
- Infrastructure: MikroORM mappings/repositories, PostgreSQL, SQS, and scheduled workers.
- Interface: HTTP controllers, validation contracts, and message adapters.

The domain must not import NestJS or ORM decorators. Persistence models and mappers rehydrate domain objects through explicit `rehydrate` factories.

## Domain model

### Money

`Money` is immutable and stores an exact decimal value plus an ISO-4217 currency. Input and output use decimal strings with exactly two fractional digits. Parsing rejects blank input, signs where the contract requires non-negative values, exponent notation, non-finite values, and more or fewer than two decimal places. Arithmetic requires matching currencies and never converts through JavaScript `number`.

The challenge operates in BRL, while the value object remains multi-currency and rejects cross-currency arithmetic.

### Wallet

`Wallet` is the aggregate root for balance changes. It starts at version 1. Its version increases exactly once for every balance-changing transaction and does not increase for LOSS or rejected transactions. Debit rejects insufficient funds; credit and debit both create enough information for exactly one corresponding ledger entry.

### Wager transaction

Transactions start as `PENDING` and may move to `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, or `FAILED`. The last three states are terminal. `OPENING` is internal and cannot enter through HTTP or SQS.

`BET` debits, `WIN` credits, and `LOSS` records a processed result without changing balance. `REFUND` reverses a processed BET. `ROLLBACK` reverses a processed BET, WIN, or REFUND. References must match provider, player, wallet, currency, and round, and the reversal amount must equal the referenced amount. A reference cannot be reversed twice by the same reversal kind. A reversal that would make the balance negative is rejected with a distinct failure code.

### Ledger

Ledger entries are append-only and immutable. Each records direction, exact money, balance before, and balance after. A factory checks its arithmetic before construction. Every balance change creates exactly one entry, and operations without a balance effect create none.

The opening balance is represented by an internal `OPENING` transaction and a credit entry in the same SQL transaction as wallet creation.

## Persistence model and database enforcement

The principal tables are:

- `wallets`
- `wager_transactions`
- `wallet_ledger_entries`
- `inbox_messages`
- `outbox_messages`

PostgreSQL uses exact `numeric` columns for money, accompanied by currency columns. Application mappers convert database decimal strings directly to and from `Money`.

At minimum, migrations enforce:

- unique `(player_id, currency)` wallet ownership;
- non-negative wallet balance and version greater than or equal to one;
- unique idempotency key;
- unique `(provider_id, external_transaction_id)`;
- unique `(wallet_id, transaction_id)` ledger entry;
- unique `(consumer_name, message_id)` inbox record;
- valid non-negative amounts, currencies, directions, kinds, and statuses;
- referential integrity among transactions, wallets, and ledger entries;
- append-only ledger protection against UPDATE and DELETE using PostgreSQL triggers.

Migrations are versioned and reversible. The down migration may remove the append-only trigger before dropping its table, but application runtime roles will never mutate committed ledger rows.

## Concurrency and transaction boundary

The unit of concurrency is `wallet_id`. Financial processing runs in a database transaction and acquires a pessimistic row lock (`SELECT ... FOR UPDATE`) on the wallet before evaluating balance-sensitive rules. Operations for the same wallet serialize; different wallets retain database-level parallelism. No global application or database lock is used.

The atomic SQL transaction contains, as applicable:

- wager transaction creation or transition;
- wallet balance and version update;
- ledger insertion;
- inbox receipt and completion;
- outbox event insertion.

An acknowledgement is sent to SQS only after commit. A rollback leaves none of these partial effects visible. Database uniqueness constraints settle races around first-time idempotency and inbox insertion; the losing execution reloads the committed result and treats an identical payload as replay.

## Idempotency

The `Idempotency-Key` header is mandatory for HTTP and supplied in the SQS data contract. The system hashes canonical JSON containing only normalized business fields, with object keys sorted recursively. SHA-256 is used and documented.

An existing key with the same hash returns the originally persisted result and balance observed for that result, with `idempotentReplay: true`. An existing key with a different hash returns an idempotency conflict and never applies the new payload. The persisted transaction therefore includes the result snapshot needed to reproduce the original response independently of the wallet's current balance.

## Entry flows

HTTP and SQS adapters validate their transport contracts and call the same application use case. The flow is:

1. Validate and normalize the contract.
2. Calculate the canonical payload hash.
3. Begin the SQL transaction and settle idempotency/inbox races.
4. Lock the target wallet.
5. Apply domain rules and transitions.
6. Persist the transaction, wallet mutation, ledger entry, and outbox events.
7. Complete the inbox record when applicable.
8. Commit.
9. Return the HTTP result or acknowledge the SQS message.

Business rejection is a committed, terminal, auditable outcome. Invalid transport payloads are not domain transactions. Infrastructure errors before commit are safe to retry. Permanent message-format errors are routed to the DLQ according to the documented receive policy.

## Out-of-order references

When a valid REFUND or ROLLBACK refers to a transaction that does not yet exist, it is persisted as `PENDING_REFERENCE` and emits `WagerTransactionPendingReference`. A scheduled worker claims due records with `FOR UPDATE SKIP LOCKED`, then invokes the same processing policy used by initial submission.

Pending reference metadata records attempt count and next attempt time. Retries use capped exponential backoff. The initial design uses 10 attempts with delays capped at one hour. If the reference still does not exist after the final attempt, the transaction becomes `REJECTED` with `REFERENCE_NOT_FOUND`, and a rejection event is queued. These values are configuration with deterministic tests.

## Inbox and SQS

The consumer deduplicates using `(consumer_name, message_id)` in PostgreSQL. Redelivery of a completed inbox message is acknowledged without repeating the domain effect. A duplicate message ID with a different payload hash is treated as a permanent integrity violation and routed to the DLQ.

Errors are classified as:

- Business: committed terminal outcome, then acknowledge.
- Transient infrastructure: do not acknowledge; allow visibility timeout/redelivery with backoff.
- Permanent transport or integrity failure: send to DLQ and acknowledge only after confirmed DLQ publication.

On SIGTERM, workers stop polling, wait for in-flight processing up to a configured grace period, and allow unfinished messages to become visible again. They never acknowledge work whose database transaction was not confirmed.

## Transactional outbox

Domain outcomes enqueue concrete integration event subclasses in the same database transaction. The minimum event types are:

- `WagerTransactionProcessed`
- `WagerTransactionRejected`
- `WalletBalanceChanged`
- `WagerTransactionPendingReference`

An outbox publisher claims due rows in short batches using `FOR UPDATE SKIP LOCKED`, increments retry metadata on failure, and marks an event published only after SQS confirms publication. A crash after publish but before marking the row can duplicate an event; event IDs remain stable so downstream consumers can deduplicate. The design promises at-least-once publication, not impossible exactly-once delivery.

## API and error semantics

The implementation exposes every endpoint required by the challenge. Responses consistently distinguish:

- `400` invalid transport payload;
- `404` missing resource on queries;
- `409` duplicate wallet or idempotency/payload conflict;
- `422` committed business rejection;
- `202` accepted transaction awaiting a reference;
- `503` transient dependency failure.

Idempotent replay returns the same domain outcome and appropriate success/rejection status with `idempotentReplay: true`. Health liveness is process-only; readiness checks PostgreSQL and SQS. Health routes bypass the no-op authentication extension point.

## Reconciliation

Reconciliation reconstructs the balance from immutable ledger entries, starting at zero and applying credits/debits in stable `(created_at, id)` order. It compares the exact result with the materialized wallet balance. Divergence is returned, logged structurally, and increments a metric; it is never repaired automatically.

Ledger pagination uses an opaque encoded cursor containing the stable `(created_at, id)` boundary rather than offsets.

## Observability

Structured JSON logs include available correlation, message, transaction, wallet, and provider identifiers, without full financial payloads or secrets. Metrics cover transaction status, duplicate detection, retries, DLQ messages, lock conflicts/waits, outbox lag, processing latency, and reconciliation mismatches.

## Testing strategy

Development follows red-green-refactor TDD. Unit tests use real domain objects and cover Money parsing/arithmetic, wallet invariants, transaction transitions, wager rules, currency conflicts, and payload-hash conflicts.

Integration tests run against real PostgreSQL and LocalStack containers. They cover migrations and constraints, atomic persistence, inbox redelivery, outbox claiming, retry/DLQ, and restart recovery. Test code may isolate external timing and clocks, but it will not replace PostgreSQL or SQS entirely with mocks.

Concurrency tests execute genuine parallel calls and multiple application processes. They prove:

- 50 identical bets create one debit;
- two concurrent BRL 80.00 bets against BRL 100.00 produce one processed transaction, one insufficient-funds rejection, one ledger debit, and BRL 20.00 remaining;
- independent wallets progress concurrently;
- at least three instances remain correct;
- death after commit/before acknowledgement does not duplicate effects;
- two outbox publishers do not lose events;
- reference-before-original processing converges;
- service restart preserves the final invariant.

Every integration/concurrency scenario finishes by verifying that the wallet's materialized balance equals the exact balance reconstructed from its ledger.

## Delivery sequence

The implementation proceeds as independently testable vertical increments:

1. Project foundation and Money.
2. Wallet, wager transaction, and ledger domain.
3. PostgreSQL schema, mappings, migrations, and repositories.
4. Transactional processing use case and HTTP API.
5. Persistent inbox and SQS ingestion.
6. Transactional outbox and concurrent publisher.
7. Pending-reference scheduler.
8. Concurrency/recovery suite.
9. Observability, architecture documentation, and final Compose workflow.

The repository will include setup commands and trade-offs in `README.md` and `ARCHITECTURE.md`. Authentication remains an explicit documented extension point unless all scored requirements are complete before the deadline.
