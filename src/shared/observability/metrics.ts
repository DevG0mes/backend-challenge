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

  toPrometheus(): string {
    const families = new Map<string, { type: 'counter' | 'gauge' | 'histogram'; samples: string[] }>();
    const add = (key: string, type: 'counter' | 'gauge' | 'histogram', values: readonly number[]) => {
      const { name, labels } = this.decodeKey(key);
      const metricName = this.normalizeName(name);
      const labelText = this.renderLabels(labels);
      const family = families.get(metricName) ?? { type, samples: [] };
      if (type === 'histogram') {
        family.samples.push(`${metricName}_count${labelText} ${values.length}`);
        family.samples.push(`${metricName}_sum${labelText} ${values.reduce((total, value) => total + value, 0)}`);
      } else {
        family.samples.push(`${metricName}${labelText} ${values[0]}`);
      }
      families.set(metricName, family);
    };

    for (const [key, value] of this.counters) add(key, 'counter', [value]);
    for (const [key, values] of this.histograms) add(key, 'histogram', values);
    for (const [key, value] of this.gauges) add(key, 'gauge', [value]);

    const lines: string[] = [];
    for (const [name, family] of [...families].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`# TYPE ${name} ${family.type}`, ...family.samples.sort());
    }
    return `${lines.join('\n')}\n`;
  }

  private key(name: string, labels: MetricLabels): string {
    const normalized = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
    return `${name}:${JSON.stringify(normalized)}`;
  }

  private decodeKey(key: string): { name: string; labels: Array<[string, string]> } {
    const separator = key.indexOf(':[');
    return {
      name: key.slice(0, separator),
      labels: JSON.parse(key.slice(separator + 1)) as Array<[string, string]>,
    };
  }

  private normalizeName(name: string): string {
    const normalized = name.replace(/[^a-zA-Z0-9_:]/g, '_');
    return /^[a-zA-Z_:]/.test(normalized) ? normalized : `_${normalized}`;
  }

  private renderLabels(labels: Array<[string, string]>): string {
    if (labels.length === 0) return '';
    const rendered = labels.map(([name, value]) => {
      const escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
      return `${this.normalizeName(name)}="${escaped}"`;
    });
    return `{${rendered.join(',')}}`;
  }
}
