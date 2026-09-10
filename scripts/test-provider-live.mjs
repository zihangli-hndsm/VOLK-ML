import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalizeAiConfig } from '../src/core/ai/aiSettings.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { createTeachingDialogueProvider, TEACHING_DIALOGUE_AUTHORED_CASES } from '../src/core/exploration/teachingDialoguePilot.js';
import {
  TEACHING_DIALOGUE_T7_MATRIX_RUNS,
  TEACHING_DIALOGUE_T7_MAX_CASES,
  assertTeachingDialogueT7FixtureIntegrity,
  runTeachingDialogueT7Matrix,
} from '../src/core/exploration/teachingDialogueT7Matrix.js';
import { createProviderLiveReport, PROVIDER_LIVE_TIMEOUT_MS, safeErrorReport } from './provider-test-support.mjs';

const MAX_INITIAL_CALLS = 24;
const ARTIFACT_PATH = '.test-artifacts/provider-live-report.json';
const safeGit = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return null; }
};

function parseOption(args, name, fallback = null) {
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function baseReport({ mode, requestedCases, skippedCases, reason = null, result = null, networkAttempts = 0, usageSummary = null } = {}) {
  return createProviderLiveReport({
    mode,
    requestedCases,
    skippedCases,
    revision: safeGit(['rev-parse', '--short', 'HEAD']) ?? 'unknown',
    head: safeGit(['rev-parse', 'HEAD']),
    dirty: Boolean(safeGit(['status', '--porcelain'])),
    reason,
    result,
    networkAttempts,
    policyTimeoutMs: PROVIDER_LIVE_TIMEOUT_MS,
    usageSummary,
  });
}

function writeReport(report) {
  fs.mkdirSync('.test-artifacts', { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report));
}

function selectedCases(args) {
  const mode = parseOption(args, '--mode', 'full');
  if (!['smoke', 'full'].includes(mode)) throw new Error('invalid-mode');
  const requested = parseOption(args, '--cases', null);
  const available = TEACHING_DIALOGUE_AUTHORED_CASES.slice(0, TEACHING_DIALOGUE_T7_MAX_CASES);
  const selectedIds = requested
    ? requested.split(',').map((value) => value.trim()).filter(Boolean)
    : mode === 'smoke' ? available.slice(0, 3).map((item) => item.id) : available.map((item) => item.id);
  const known = new Set(available.map((item) => item.id));
  if (!selectedIds.length || selectedIds.some((id) => !known.has(id)) || new Set(selectedIds).size !== selectedIds.length) throw new Error('invalid-case-selection');
  const selected = available.filter((item) => selectedIds.includes(item.id));
  if (selected.length * TEACHING_DIALOGUE_T7_MATRIX_RUNS > MAX_INITIAL_CALLS) throw new Error('initial-call-cap-exceeded');
  return { mode, selected, selectedIds, skipped: available.filter((item) => !selectedIds.includes(item.id)).map((item) => item.id) };
}

async function main() {
  const args = process.argv.slice(2);
  const selection = selectedCases(args);
  assertTeachingDialogueT7FixtureIntegrity({ revision: `live-preflight-${selection.mode}`, run: 1 });
  if (!args.includes('--allow-live')) {
    writeReport(baseReport({ mode: selection.mode, requestedCases: selection.selectedIds, skippedCases: selection.skipped, reason: 'missing-allow-live-authorization' }));
    process.exitCode = 2;
    return;
  }
  const apiKey = String(process.env.VOLK_PROVIDER_API_KEY ?? process.env.VOLK_AI_API_KEY ?? '');
  const config = normalizeAiConfig({
    protocol: process.env.VOLK_PROVIDER_PROTOCOL ?? 'openai-compatible',
    endpoint: process.env.VOLK_PROVIDER_ENDPOINT ?? '',
    model: process.env.VOLK_PROVIDER_MODEL ?? '',
    vendorId: process.env.VOLK_PROVIDER_VENDOR ?? '',
    apiKey,
  });
  if (!config?.apiKey.trim() || !config.model.trim()) {
    writeReport(baseReport({ mode: selection.mode, requestedCases: selection.selectedIds, skippedCases: selection.skipped, reason: 'missing-live-configuration' }));
    process.exitCode = 2;
    return;
  }

  let networkAttempts = 0;
  const fetchImpl = async (endpoint, options) => {
    networkAttempts += 1;
    if (networkAttempts > MAX_INITIAL_CALLS) throw new Error('live-attempt-cap-exceeded');
    return globalThis.fetch(endpoint, options);
  };
  const gateway = createProviderGateway({ fetchImpl });
  const provider = createTeachingDialogueProvider({ gateway, config });
  const result = await runTeachingDialogueT7Matrix({
    provider,
    revision: safeGit(['rev-parse', '--short', 'HEAD']) ?? 'unknown',
    runs: TEACHING_DIALOGUE_T7_MATRIX_RUNS,
    cases: selection.selected,
    timeoutMs: PROVIDER_LIVE_TIMEOUT_MS,
  });
  const report = baseReport({
    mode: selection.mode,
    requestedCases: selection.selectedIds,
    skippedCases: selection.skipped,
    result,
    networkAttempts,
    usageSummary: gateway.getUsageSummary?.(),
  });
  writeReport(report);
  if (report.status !== 'passed' || report.executedRuns === 0) process.exitCode = 1;
}

main().catch((error) => {
  const args = process.argv.slice(2);
  let selection;
  try { selection = selectedCases(args); } catch { selection = { mode: 'unknown', selectedIds: [], skipped: [] }; }
  const report = baseReport({ mode: selection.mode, requestedCases: selection.selectedIds, skippedCases: selection.skipped, reason: safeErrorReport(error).code });
  writeReport(report);
  process.exitCode = 1;
});
