# Professional Submission and Load Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the mandatory-requirement gaps and produce a reproducible, reconciled load-test report for the final submission.

**Architecture:** Extend the existing singleton in-memory metrics collector with deterministic Prometheus rendering and expose it through a public controller. Strengthen the real-process harness with restart support, then add a domain-aware Bun load runner that drives all three Compose replicas and treats reconciliation as the final correctness gate. Finish with reviewer-facing compliance and load documentation, then remove internal workflow artifacts.

**Tech Stack:** Bun 1.4, TypeScript strict, NestJS 12, MikroORM 7, PostgreSQL 16, LocalStack SQS, Docker Compose

**Spec:** `docs/superpowers/specs/2026-10-16-professional-submission-and-load-test-design.md`

## Global Constraints

- Do not add a load-testing dependency; use Bun native `fetch`, timers, JSON, and filesystem APIs.
- `GET /metrics` must use Prometheus text format and remain unauthenticated.
- Never expose monetary payloads, secrets, tokens, or unbounded identifiers as metric labels.
- Load results may be documented only after running the final committed code.
- Any reconciliation mismatch makes the load test fail regardless of throughput.
- Preserve at-least-once semantics; do not claim exactly-once delivery.
- Target the three replicas directly; do not imply that a load balancer exists.

## Review Focus

- Prometheus label values containing quotes, backslashes, or newlines must be escaped and tested in Task 1.
- Invalid load configuration such as zero concurrency or malformed base URLs must fail before traffic and be tested in Task 3.
- A non-2xx measured request must be counted without aborting the remaining workers and be tested in Task 3.
- Restarting a process must not reuse a stale child handle or report readiness before the new process is serving; Task 2 tests the full lifecycle.
- Percentiles for an empty or one-element sample must be deterministic and tested in Task 3.

---

### Task 1: Prometheus Metrics Endpoint

**Files:**
- Modify: `src/shared/observability/metrics.ts`
- Create: `src/shared/observability/metrics.controller.ts`
- Modify: `src/app.module.ts`
- Modify: `test/unit/shared/observability/redaction.test.ts`
- Create: `test/e2e/http/metrics.test.ts`

**Interfaces:**
- Consumes: existing `InMemoryMetrics.increment`, `observe`, and `setGauge` calls.
- Produces: `InMemoryMetrics.toPrometheus(): string` and public `GET /metrics` with `text/plain; version=0.0.4`.

- [ ] **Step 1: Write failing renderer tests** for stable ordering, counters, gauges, histogram count/sum, normalized metric names, sorted labels, and escaped quote/backslash/newline values.
- [ ] **Step 2: Run `bun test test/unit/shared/observability/redaction.test.ts`** and verify failure because `toPrometheus` does not exist.
- [ ] **Step 3: Implement `InMemoryMetrics.toPrometheus(): string`** with deterministic output and no application-domain labels beyond those already recorded.
- [ ] **Step 4: Run the unit test** and verify all observability tests pass.
- [ ] **Step 5: Write a failing E2E test** asserting `/metrics` is public, returns the Prometheus content type, and contains representative application metrics after a wager.
- [ ] **Step 6: Implement `MetricsController` and register it with the same singleton `InMemoryMetrics` instance** used by use cases and workers.
- [ ] **Step 7: Run `$env:TEST_POSTGRES_PORT='55432'; bun test test/e2e/http/metrics.test.ts`** and verify pass.
- [ ] **Step 8: Commit** with message `feat: expose operational metrics`.

### Task 2: Explicit Process Restart Recovery

**Files:**
- Modify: `test/support/process-harness.ts`
- Modify: `test/concurrency/crash-recovery.concurrent.test.ts`

**Interfaces:**
- Consumes: existing three-process harness and wallet invariant helper.
- Produces: `ProcessHarness.restartInstance(index: number): Promise<void>`.

- [ ] **Step 1: Change the crash recovery test** to stop instance 0, restart instance 0, replay through the restarted instance, assert the original transaction ID, assert one ledger effect, and reconcile the wallet.
- [ ] **Step 2: Run only the crash recovery concurrency test through the existing concurrency environment** and verify failure because restart is missing.
- [ ] **Step 3: Refactor process creation into a private `spawnInstance(index: number): ChildProcess` and implement `restartInstance(index: number): Promise<void>`**, replacing the dead handle and awaiting readiness.
- [ ] **Step 4: Run `bun run test:concurrency`** and verify all real-process scenarios pass.
- [ ] **Step 5: Commit** with message `test: prove consistency after process restart`.

### Task 3: Domain-Aware Bun Load Runner

**Files:**
- Create: `scripts/load-test/config.ts`
- Create: `scripts/load-test/statistics.ts`
- Create: `scripts/load-test/runner.ts`
- Create: `scripts/load-test.ts`
- Create: `test/unit/load-test/config.test.ts`
- Create: `test/unit/load-test/statistics.test.ts`
- Create: `test/unit/load-test/runner.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `LoadTestConfig`, `parseLoadTestConfig(env)`, `summarizeLatencies(samples)`, `runScenario(options)`, and the `bun run test:load` command.
- Output: `reports/load-test.json` containing environment metadata plus `distributed` and `hotWallet` results.

- [ ] **Step 1: Write failing config tests** for defaults, three validated base URLs, positive duration/concurrency/wallet count, exact two-decimal amount, and invalid zero/malformed inputs.
- [ ] **Step 2: Implement `parseLoadTestConfig(env: Record<string,string|undefined>): LoadTestConfig`** and run config tests to green.
- [ ] **Step 3: Write failing statistics tests** for empty, singleton, p50, p95, p99, max, request rate, and HTTP status counts.
- [ ] **Step 4: Implement deterministic nearest-rank percentile summarization** and run statistics tests to green.
- [ ] **Step 5: Write failing runner tests with a local fake HTTP server** proving round-robin targets, unique idempotency identities, continued accounting after non-2xx responses, and failure on reconciliation mismatch.
- [ ] **Step 6: Implement `runScenario`** with fixed worker concurrency until the monotonic deadline, per-request latency collection, setup outside the measured window, and reconciliation as the terminal gate.
- [ ] **Step 7: Implement `scripts/load-test.ts`** to run distributed then hot-wallet scenarios, print compact summaries, and write formatted JSON only after both reconcile.
- [ ] **Step 8: Add `test:load` to `package.json` and ignore `reports/load-test.json`**.
- [ ] **Step 9: Run all new unit tests and `bun run build`**; verify pass.
- [ ] **Step 10: Commit** with message `test: add reconciled load scenarios`.

### Task 4: Requirements and Load Documentation Skeleton

**Files:**
- Create: `docs/REQUIREMENTS.md`
- Create: `docs/LOAD_TEST.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: verified implementation/tests and the output schema from Task 3.
- Produces: reviewer-facing compliance matrix and load methodology without invented results.

- [ ] **Step 1: Create the requirements matrix** covering every mandatory domain, infrastructure, API, observability, and test requirement with implementation and evidence paths.
- [ ] **Step 2: Create the load report skeleton** with environment fields, exact command, methodology, result-table placeholders explicitly marked as awaiting execution, interpretation rules, and limitations.
- [ ] **Step 3: Update README and architecture** to link the new documents and accurately describe `/metrics` and explicit process restart.
- [ ] **Step 4: Run a local Markdown-link validation and `git diff --check`**; verify no broken local links or whitespace errors.
- [ ] **Step 5: Commit** with message `docs: map requirements and load methodology`.

### Task 5: Full Verification and Measured Load Run

**Files:**
- Modify: `docs/LOAD_TEST.md`
- Modify: `README.md`
- Generated, ignored: `reports/junit.xml`
- Generated, ignored: `reports/load-test.json`

**Interfaces:**
- Consumes: final code from Tasks 1-4.
- Produces: measured local results and a truthful final report.

- [ ] **Step 1: Run `docker compose down --volumes`**, then `docker compose up -d --build`; verify migration exit 0, PostgreSQL/LocalStack healthy, and all three APIs ready.
- [ ] **Step 2: Stop application replicas before shared-infrastructure tests** and run `$env:TEST_POSTGRES_PORT='55432'; bun run test:report`; require zero failures.
- [ ] **Step 3: Run `$env:TEST_POSTGRES_PORT='55432'; bun run test:concurrency`**; require every scenario including restart to pass.
- [ ] **Step 4: Start all three replicas and run the documented `bun run test:load` command**; require zero reconciliation mismatches.
- [ ] **Step 5: Record host CPU, memory, OS, Docker, Bun version, scenario configuration, throughput, p50/p95/p99/max, errors, status distribution, and reconciliation results** from the generated JSON into `docs/LOAD_TEST.md`.
- [ ] **Step 6: Add a compact measured-results table to README** with a local-environment disclaimer.
- [ ] **Step 7: Cross-check every documented number against `reports/load-test.json`**, validate Markdown links, and run `git diff --check`.
- [ ] **Step 8: Commit** with message `docs: publish verified load results`.

### Task 6: Submission Cleanup and Final Gate

**Files:**
- Delete: `docs/superpowers/plans/2026-10-15-distributed-wagering-processor.md`
- Delete: `docs/superpowers/plans/2026-10-16-professional-submission-and-load-test.md`
- Delete: `docs/superpowers/specs/2026-10-15-distributed-wagering-processor-design.md`
- Delete: `docs/superpowers/specs/2026-10-16-professional-submission-and-load-test-design.md`
- Modify if needed: `README.md`, `ARCHITECTURE.md`, `docs/REQUIREMENTS.md`, `docs/TESTING.md`

**Interfaces:**
- Produces: clean reviewer-facing branch with no internal workflow artifacts.

- [ ] **Step 1: Remove all tracked `docs/superpowers` artifacts** and confirm no reviewer document links to them.
- [ ] **Step 2: Scan for TODO/TBD/placeholders, skipped tests, accidental credentials, other-author names, unsupported performance claims, and internal workflow references**; fix only findings within submission scope.
- [ ] **Step 3: Run final build, standard suite, concurrency suite, Docker image build, Markdown-link validation, and `git diff --check`**; require every command to pass.
- [ ] **Step 4: Commit** with message `chore: finalize professional submission`.
- [ ] **Step 5: Push `feat/wagering-processor`, verify Pull Request #1 shows the final commits, and request one whole-branch review before merge**.
