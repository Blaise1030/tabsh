import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performanceRows } from './performance.ts';

test('performance shows RAM and CPU for the whole of tabsh', () => {
  assert.deepEqual(
    performanceRows({
      total: { memory_bytes: 48 * 1024 * 1024, cpu_percent: 12.4 },
      processes: [
        { name: 'tabsh', memory_bytes: 40 * 1024 * 1024, cpu_percent: 1.26 },
        { name: 'zsh', memory_bytes: Math.round(1.5 * 1024 * 1024), cpu_percent: 0.04 },
      ],
    }),
    [
      ['RAM', '48 MB'],
      ['CPU', '12%'],
    ],
  );
});

test('a gigabyte of memory is shown in GB', () => {
  assert.deepEqual(
    performanceRows({
      total: { memory_bytes: 1024 ** 3, cpu_percent: 1.26 },
      processes: [],
    }),
    [
      ['RAM', '1 GB'],
      ['CPU', '1.3%'],
    ],
  );
});
