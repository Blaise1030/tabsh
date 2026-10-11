// The palette's Performance page: RAM and CPU for tabsh as a whole. The
// daemon's per-process figures stay in the answer; the page shows the total.

export interface Reading {
  memory_bytes: number;
  cpu_percent: number;
}

export interface Performance {
  total: Reading;
  processes: (Reading & { name: string })[];
}

const UNITS: [number, string][] = [
  [1024 ** 3, 'GB'],
  [1024 ** 2, 'MB'],
  [1024, 'KB'],
  [1, 'B'],
];

function formatAmount(n: number): string {
  const rounded = n >= 10 || Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.round(rounded)) : String(rounded);
}

function formatMemory(bytes: number): string {
  const [unit, label] = UNITS.find(([size]) => bytes >= size) ?? [1, 'B'];
  return `${formatAmount(bytes / unit)} ${label}`;
}

function formatCpu(percent: number): string {
  const rounded = percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
  const text = Number.isInteger(rounded) ? String(Math.round(rounded)) : String(rounded);
  return `${text}%`;
}

export function performanceRows(info: Performance): [string, string][] {
  return [
    ['RAM', formatMemory(info.total.memory_bytes)],
    ['CPU', formatCpu(info.total.cpu_percent)],
  ];
}
