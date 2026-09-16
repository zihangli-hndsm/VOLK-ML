import assert from 'node:assert/strict';
import fs from 'node:fs';

const ask = fs.readFileSync(new URL('../src/components/playground/AskVolkPanel.jsx', import.meta.url), 'utf8');
const teaching = fs.readFileSync(new URL('../src/components/playground/TeachingDialoguePanel.jsx', import.meta.url), 'utf8');
const dialog = fs.readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
const harness = fs.readFileSync(new URL('../src/dev/r148LifecycleHarness.jsx', import.meta.url), 'utf8');
const harnessPage = fs.readFileSync(new URL('../r148-lifecycle-harness.html', import.meta.url), 'utf8');

assert.match(dialog, /import \{ useCallback, useEffect, useMemo, useRef, useState \} from 'react'/, 'stable parent lifecycle callback is imported');
assert.match(ask, /const lifecycleRef = useRef\(onRequestLifecycle\)/);
assert.match(ask, /if \(activeRequestId\.current\) lifecycleRef\.current\?\.\(\{ phase: 'cancel'/);
assert.match(ask, /\}, \[\]\);/);
assert.match(teaching, /const lifecycleRef = useRef\(onRequestLifecycle\)/);
assert.match(teaching, /if \(activeRequestId\.current\) lifecycleRef\.current\?\.\(\{ phase: 'cancel'/);
assert.match(teaching, /\}, \[\]\);/);
assert.match(harness, /AskVolkPanel/);
assert.match(harness, /TeachingDialoguePanel/);
assert.match(harness, /LumiCompanion/);
assert.match(harness, /createLumiPresentationState/);
assert.match(harness, /new Promise\(\(resolve, reject\)/, 'harness uses delayed deterministic adapters');
for (const action of ['ask-start', 'ask-resolve', 'ask-resolve-oldest', 'ask-reject', 'parent-rerender', 'context-change', 'unmount', 'reset', 'teaching-resolve', 'teaching-resolve-oldest', 'teaching-reject']) assert.match(harness, new RegExp(`data-action="${action}"`));
assert.match(harnessPage, /r148LifecycleHarness\.jsx/);

console.log('Mounted LUMI lifecycle wiring checks passed (static source assertions only); executable mounted coverage is provided by scripts/run-r148-browser.ps1.');
