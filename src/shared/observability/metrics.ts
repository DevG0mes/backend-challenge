export type MetricLabels = Record<string, string>;

export interface OperationalMetrics {
  increment(name: string, labels?: MetricLabels, value?: number): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
}

export class InMemoryMetrics implements OperationalMetrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, labels: MetricLabels = {}, value = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.key(name, labels);
    this.histograms.set(key, [...(this.histograms.get(key) ?? []), value]);
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.gauges.set(this.key(name, labels), value);
  }

  counter(name: string, labels: MetricLabels = {}): number {
    return this.counters.get(this.key(name, labels)) ?? 0;
  }

  histogram(name: string, labels: MetricLabels = {}): readonly number[] {
    return this.histograms.get(this.key(name, labels)) ?? [];
  }

  gauge(name: string, labels: MetricLabels = {}): number | undefined {
    return this.gauges.get(this.key(name, labels));
  }

  private key(name: string, labels: MetricLabels): string {
    const normalized = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
    return `${name}:${JSON.stringify(normalized)}`;
  }
}
