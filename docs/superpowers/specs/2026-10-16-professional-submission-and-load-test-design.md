# Professional Submission and Load Test Design

## Objective

Close the remaining compliance and presentation gaps before merging the wagering processor into `master`. The final repository must expose useful operational metrics, prove recovery after a real process restart, provide an honest reproducible load experiment, map challenge requirements to evidence, and contain only reviewer-facing documentation.

## Scope

This increment includes:

- a public Prometheus-compatible `GET /metrics` endpoint;
- an explicit stop-and-restart multi-process consistency test;
- a native Bun load generator for distributed-wallet and hot-wallet scenarios;
- a generated JSON load result ignored by Git;
- a committed human-readable load report containing measured results;
- a requirements compliance matrix;
- README and architecture updates;
- removal of internal planning artifacts from the final branch;
- complete regression, concurrency, build, Docker, and load verification.

Authentication, a load balancer, Grafana, OpenTelemetry, automatic reconciliation repair, and exactly-once messaging remain outside scope.

## Operational Metrics

`InMemoryMetrics` remains the application collector and gains a deterministic Prometheus text renderer. Metric names and label keys are normalized and output in stable order. Counters, gauges, and histogram samples are exposed without leaking payloads, monetary values, credentials, or high-cardinality request data.

`GET /metrics` returns `text/plain; version=0.0.4` and remains public like health endpoints. Tests cover rendering, labels, escaping, content type, and representative metrics required by the challenge: transaction status, duplicates, retries, DLQ, lock wait/conflicts, outbox lag, and processing latency.

The implementation documents that metrics are process-local. Production aggregation requires Prometheus scraping every replica.

## Restart Recovery Proof

The process harness gains the ability to restart a stopped instance on its original port and wait for readiness. The recovery scenario will:

1. process and commit a financial operation through one instance;
2. stop that instance;
3. restart it as a new process;
4. replay or query the committed operation through the restarted process;
5. confirm the same transaction identity and no duplicated ledger effect;
6. reconcile the wallet and assert stored balance equals the reconstructed ledger balance.

This complements the existing tests for redelivery after commit, publisher restart, multi-instance idempotency, and concurrent outbox claims.

## Native Bun Load Generator

The load test is a domain-aware Bun script invoked by `bun run test:load`. It targets the three Compose application ports directly in round-robin order, avoiding an unimplemented load balancer.

Configuration is supplied through environment variables with safe defaults for duration, concurrency, number of wallets, base URLs, and monetary amount. The runner validates configuration before sending traffic.

### Distributed-wallet scenario

- create a configurable pool of funded wallets;
- warm the application before measurement;
- issue unique `BET` operations concurrently across wallets and replicas;
- use unique external transaction IDs and idempotency keys;
- collect latency and response status for every measured request;
- reconcile every affected wallet after traffic stops.

### Hot-wallet scenario

- create one wallet with sufficient funds;
- warm the application separately;
- issue unique concurrent `BET` operations against that wallet across all replicas;
- measure serialized progress under the wallet row lock;
- reconcile the wallet after traffic stops.

### Measurements

Each scenario records:

- start time and duration;
- total requests and successful/failed requests;
- throughput in requests per second;
- p50, p95, p99, and maximum latency;
- HTTP status distribution;
- reconciliation count and inconsistencies;
- configured concurrency, wallet count, base URLs, and amount.

The complete machine-readable result is written to `reports/load-test.json` and ignored by Git. The committed `docs/LOAD_TEST.md` records the environment, exact command, selected results, methodology, limitations, and interpretation. No result is claimed until the test has actually run on the final code.

## Failure Handling and Integrity

Setup failures abort the experiment. Individual measured request failures are counted rather than hidden. Any reconciliation mismatch makes the load command fail, regardless of throughput. The script avoids printing full financial payloads or credentials.

Load traffic uses amounts and initial balances that cannot overflow the database and prevents expected insufficient-funds rejections from being classified as infrastructure performance. The report clearly distinguishes local emulation results from AWS behavior.

## Requirements Matrix

`docs/REQUIREMENTS.md` maps every mandatory challenge area and every required test scenario to:

- status: met, met with documented trade-off, or optional/not implemented;
- implementation location;
- automated evidence;
- relevant documentation.

The matrix must not claim authentication, external metric aggregation, exactly-once delivery, or formal production capacity.

## Repository Presentation

The README keeps the project-focused overview and gains links to the load report and requirements matrix. Measured performance appears in a compact table with environment context and a warning that results are local.

Internal `docs/superpowers` planning documents are removed from the final branch after the implementation plan has been executed. The original challenge remains recoverable from Git history; reviewer-facing documentation explains the delivered solution rather than exposing internal workflow notes.

## Verification and Acceptance

The increment is accepted only when:

- TypeScript build succeeds;
- the complete standard suite passes;
- the multi-process concurrency suite passes, including explicit restart;
- the metrics endpoint and renderer tests pass;
- Docker Compose builds and all dependencies become healthy;
- the load test completes both scenarios;
- every affected wallet reconciles successfully after load;
- the JSON result and Markdown report agree;
- local Markdown links resolve;
- `git diff --check` passes;
- the working tree is clean after commit and push.

The final answer about compliance will distinguish mandatory requirements from optional differentials and disclose any remaining trade-offs.
