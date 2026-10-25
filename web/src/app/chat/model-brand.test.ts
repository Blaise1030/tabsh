import assert from 'node:assert/strict';
import test from 'node:test';
import { modelBrand } from './model-brand.ts';

test('a model wears the mark of the vendor that makes it', () => {
  assert.equal(modelBrand('claude-sonnet-4-5', 'Claude Sonnet 4.5'), 'claude');
  assert.equal(modelBrand('opus', 'Opus 4.1'), 'claude');
  assert.equal(modelBrand('gpt-5', 'GPT-5'), 'openai');
  assert.equal(modelBrand('o3', 'o3'), 'openai');
  assert.equal(modelBrand('gemini-2.5-pro', 'Gemini 2.5 Pro'), 'gemini');
  assert.equal(modelBrand('composer-1', 'Composer 1'), 'cursor');
});

test('an unknown or auto model has no vendor mark', () => {
  assert.equal(modelBrand('auto', 'Auto'), null);
  assert.equal(modelBrand('fast', 'Fast'), null);
  assert.equal(modelBrand('', ''), null);
});
