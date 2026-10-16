$ErrorActionPreference = 'Stop'
$env:TEST_POSTGRES_PORT = if ($env:TEST_POSTGRES_PORT) { $env:TEST_POSTGRES_PORT } else { '55432' }

$bunCommand = Get-Command bun -ErrorAction SilentlyContinue
$bunExecutable = if ($bunCommand) {
  $bunCommand.Source
} else {
  Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
}

if (-not (Test-Path -LiteralPath $bunExecutable)) {
  throw 'Bun was not found in PATH or in the default user installation directory.'
}

$files = @(
  './test/concurrency/idempotency.concurrent.test.ts',
  './test/concurrency/competing-bets.concurrent.test.ts',
  './test/concurrency/distinct-wallets.concurrent.test.ts',
  './test/concurrency/multi-instance.concurrent.test.ts',
  './test/concurrency/crash-recovery.concurrent.test.ts'
)

foreach ($file in $files) {
  & $bunExecutable test $file
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
