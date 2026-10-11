import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `missing ${selector} rule`);
  return match[1];
}

test('welcome dialog centers a capped page column', () => {
  assert.match(rule('#welcome[open]'), /align-items:\s*stretch/);
  assert.match(rule('#welcome[open]'), /justify-content:\s*center/);
  assert.match(rule('.welcome-page'), /flex:\s*0\s+1\s+34rem/);
  assert.match(rule('.welcome-page'), /max-width:\s*calc\(100vw - 2rem\)/);
  assert.match(rule('.welcome-body'), /justify-content:\s*flex-start/);
  assert.match(rule('.welcome-body'), /padding-block:\s*min\(8vh,\s*4rem\)\s+1rem/);
  assert.match(rule('.welcome-page[data-layout="split"]'), /display:\s*grid/);
  assert.match(
    rule('.welcome-page[data-layout="split"]'),
    /grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(0,\s*1fr\)/,
  );
  assert.match(rule('.welcome-page[data-layout="split"]'), /align-content:\s*center/);
  assert.match(rule('.welcome-page[data-layout="split"]'), /"question question"/);
  assert.match(rule('.welcome-page[data-layout="split"]'), /"visual main"/);
  assert.match(rule('.welcome-page[data-layout="split"] .welcome-main'), /height:\s*0/);
  assert.match(rule('.welcome-page[data-layout="split"] .welcome-main'), /min-height:\s*100%/);
  assert.match(
    rule('.welcome-page[data-layout="split"] .welcome-main'),
    /padding:\s*clamp\(1\.25rem,\s*3vh,\s*2rem\)\s+clamp\(1\.25rem,\s*2\.5vw,\s*2rem\)/,
  );
  assert.match(rule('.welcome-page[data-layout="split"] .welcome-text'), /font-size:\s*1\.125rem/);
  assert.match(rule('.welcome-page[data-layout="split"] .welcome-text'), /padding-bottom:\s*1\.25rem/);
  assert.match(rule('.welcome-intro-message'), /display:\s*flex/);
  assert.match(rule('.welcome-intro-message'), /justify-content:\s*center/);
  assert.match(rule('.welcome-intro-message'), /overflow-y:\s*auto/);
  assert.doesNotMatch(rule('.welcome-intro-kicker'), /text-transform:\s*uppercase/);
  assert.match(rule('.welcome-intro-list'), /display:\s*flex/);
  assert.match(rule('.welcome-intro-list'), /list-style:\s*disc/);
  assert.match(rule('.welcome-intro-list'), /padding-left:\s*1\.35rem/);
  assert.match(rule('.welcome-intro-list'), /line-height:\s*1\.55/);
  assert.match(
    css,
    /@media \(max-width:\s*52rem\)\s*\{[^}]*\.welcome-page\[data-layout="split"\]\s*\{[^}]*flex-direction:\s*column/,
  );
});

test('welcome view choices use the stacked selection layout with a preview', () => {
  assert.match(rule('.welcome-app-preview'), /aspect-ratio:\s*16\s*\/\s*10/);
  assert.match(rule('.welcome-stage'), /preview-ground\.jpg/);
  assert.match(rule('.welcome-browser'), /aspect-ratio:\s*16\s*\/\s*10/);
  assert.match(rule('.welcome-browser-tab-icon'), /width:\s*1rem/);
  assert.match(rule('.welcome-browser-tab-icon'), /height:\s*1rem/);
  assert.match(rule('.welcome-preview-fit'), /display:\s*flex/);
  assert.match(rule('.welcome-preview-fit'), /height:\s*calc\(1200px \* 100cqh \/ 100cqw\)/);
  assert.match(rule('.welcome-preview-stage'), /display:\s*flex/);
  assert.match(rule('.welcome-preview-terminal'), /background:\s*var\(--background\)/);
  assert.match(rule('.welcome-preview-terminal'), /font-family:\s*var\(--preview-font\)/);
  assert.match(css, /\.welcome-preview-board\s*\{[^}]*display:\s*flex/);
  assert.match(
    css,
    /\.welcome-app-preview\[data-kind="tabs"\] \.welcome-preview-board,\s*\.welcome-app-preview\[data-kind="tabs"\] \.drawer-bar\s*\{[^}]*display:\s*none/,
  );
  assert.match(css, /\.welcome-preview-board\.list\s*\{[^}]*flex-direction:\s*column/);
  assert.match(rule('.welcome-view-list'), /flex:\s*0\s+0\s+auto/);
});

test('welcome setting choices use stacked option cards', () => {
  assert.match(rule('.welcome-choice-panel'), /flex:\s*1/);
  assert.match(rule('.welcome-choice-panel'), /min-height:\s*0/);
  assert.match(rule('.welcome-choice-list'), /display:\s*flex/);
  assert.match(rule('.welcome-choice-list'), /flex-direction:\s*column/);
  assert.match(rule('.welcome-choice-list'), /flex:\s*1/);
  assert.match(rule('.welcome-choice-list'), /gap:\s*\.375rem/);
  assert.match(rule('.welcome-choice-list'), /padding:\s*\.375rem\s+\.25rem/);
  assert.doesNotMatch(rule('.welcome-choice-list'), /max-height/);
  assert.match(rule('.welcome-choice-list'), /overflow-y:\s*auto/);
  assert.match(
    rule('.welcome-choice-list'),
    /mask-image:\s*linear-gradient\(to bottom,\s*transparent,\s*#000 \.375rem/,
  );
  assert.match(rule('#welcome:has(.welcome-choice-list) .welcome-body'), /overflow:\s*hidden/);
  assert.match(rule('.welcome-choice-card'), /min-height:\s*3\.375rem/);
  assert.match(rule('.welcome-choice-card'), /box-sizing:\s*border-box/);
  assert.match(rule('.welcome-choice-card'), /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(rule('.welcome-choice-card'), /align-items:\s*start/);
  assert.match(rule('.welcome-choice-card'), /border-radius:\s*var\(--radius,\s*\.5rem\)/);
  assert.match(rule('.welcome-choice-radio'), /border-radius:\s*999px/);
  assert.match(rule('.welcome-choice-radio'), /margin-top:\s*\.25rem/);
  assert.match(rule('.welcome-choice-swatch'), /grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  assert.match(rule('.welcome-choice-sample'), /font-family:\s*var\(--choice-font\)/);
  assert.match(rule('#welcome .welcome-page[data-layout="split"] .welcome-scroll-list'), /max-height:\s*100%/);
  assert.match(
    rule('#welcome .welcome-page[data-layout="split"] .welcome-scroll-list'),
    /padding:\s*\.375rem\s+\.25rem\s+1\.5rem/,
  );
  assert.match(
    rule('#welcome .welcome-page[data-layout="split"] .welcome-scroll-list'),
    /mask-image:\s*linear-gradient\(to bottom,\s*transparent,\s*#000 var\(--fade-t\)/,
  );
  assert.match(rule('#welcome .welcome-page[data-layout="split"] .welcome-scroll-list.fade-top'), /--fade-t:\s*4rem/);
  assert.match(
    rule('#welcome .welcome-page[data-layout="split"] .welcome-scroll-list.fade-bottom'),
    /--fade-b:\s*4rem/,
  );
  assert.match(rule('.welcome-app-preview'), /background:\s*transparent/);
  assert.match(rule('.welcome-app-preview'), /border:\s*0/);
  assert.match(rule('.welcome-app-preview'), /font-family:\s*var\(--font-sans\)/);
});
