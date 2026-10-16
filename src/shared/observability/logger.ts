const SENSITIVE_KEYS = /^(amount|balance|balanceBefore|balanceAfter|money|payload|password|secret|token|authorization|cookie)$/i;

export type LogContext = Record<string, unknown>;

export class StructuredLogger {
  constructor(private readonly write: (line: string) => void = console.log) {}

  info(message: string, context: LogContext = {}): void {
    this.log('info', message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.log('warn', message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.log('error', message, context);
  }

  private log(level: 'info' | 'warn' | 'error', message: string, context: LogContext): void {
    this.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(this.redact(context) as LogContext),
    }));
  }

  private redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.test(key) ? '[REDACTED]' : this.redact(item),
    ]));
  }
}
