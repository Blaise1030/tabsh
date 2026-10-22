import assert from 'node:assert/strict';
import { test } from 'node:test';
import { softwareRenderer } from './webgl.ts';

test('hardware renderers keep WebGL', () => {
  assert.equal(softwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'), false);
  assert.equal(softwareRenderer('Apple GPU'), false);
  // Masked or unknown strings are not proof of software rendering.
  assert.equal(softwareRenderer(''), false);
});

test('software rasterizers and no context use the DOM renderer', () => {
  assert.equal(
    softwareRenderer(
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
    ),
    true,
  );
  assert.equal(softwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
  assert.equal(softwareRenderer('Microsoft Basic Render Driver'), true);
  assert.equal(softwareRenderer(null), true);
});
