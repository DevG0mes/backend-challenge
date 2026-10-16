$ErrorActionPreference = 'Stop'
$env:TEST_POSTGRES_PORT = if ($env:TEST_POSTGRES_PORT) { $env:TEST_POSTGRES_PORT } else { '55432' }

$files = @(
  './test/concurrency/idempotency.concurrent.test.ts',
  './test/concurrency/competing-bets.concurrent.test.ts',
  './test/concurrency/distinct-wallets.concurrent.test.ts',
  './test/concurrency/multi-instance.concurrent.test.ts',
  './test/concurrency/crash-recovery.concurrent.test.ts'
)

foreach ($file in $files) {
  & bun test $file
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
