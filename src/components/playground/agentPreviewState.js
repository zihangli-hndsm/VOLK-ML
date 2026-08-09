// Pure Agent preview state helpers (PR F.2.1). The Agent panel keeps TWO
// separate sources of truth:
//   preview - the TeachingPlan + Script currently being inspected (never
//             auto-loaded into the runtime)
//   active  - the Script currently loaded in the runtime
//             (snapshot.provenance: preset/generated/composed/revised/imported)
// These helpers derive the preview-side labels and run eligibility, and build
// the next preview on each transition. They contain no React, DOM or model
// math, so the UI state machine is contract-testable in check-core.

// preview: { mode: 'composed' | 'revised' | 'imported', plan, script,
//            fidelity, dryRun, error, revisionError } | null
export function previewProvenance(preview) {
  if (!preview) return null;
  if (preview.mode === 'revised') return 'revised';
  if (preview.mode === 'composed') return 'composed';
  if (preview.mode === 'imported') return 'imported';
  return null;
}

// Imported scripts have no TeachingPlan, so goal fidelity is not available;
// they are runnable on structural validation + strict dry run + model
// compatibility (enforced by SCRIPT_LOAD). Composed/revised teaching scripts
// additionally require goal fidelity.
export function previewRunnable(preview) {
  if (!preview) return false;
  if (preview.mode === 'imported') return preview.dryRun?.valid === true;
  return preview.fidelity?.valid === true;
}

export function previewFidelityStatus(preview) {
  if (!preview) return null;
  if (preview.mode === 'imported') return 'not-available';
  if (preview.fidelity?.valid) return 'passed';
  return 'failed';
}

// Ask -> Plan -> Compose -> Preview: the runtime is never touched here.
export function compositionPreview(composed) {
  return {
    mode: composed.mode,
    plan: composed.plan,
    script: composed.script,
    fidelity: composed.fidelity,
    dryRun: composed.dryRun,
    error: null,
    revisionError: null,
  };
}

// Revise -> Preview revised: replaces the preview, never the runtime.
export function revisionPreview(previous, revised) {
  return {
    ...(previous ?? {}),
    mode: revised.mode ?? 'revised',
    plan: revised.plan,
    script: revised.script,
    fidelity: revised.fidelity,
    dryRun: revised.dryRun,
    error: null,
    revisionError: null,
  };
}

// Import -> validate -> strict dry run -> Preview imported declaration. The
// runtime is only updated when the user presses Run.
export function importedPreview({ script, dryRun }) {
  return {
    mode: 'imported',
    plan: null,
    script,
    fidelity: null,
    dryRun,
    error: null,
    revisionError: null,
  };
}

export function revisionErrorPreview(previous, revisionError) {
  return {
    ...(previous ?? {}),
    error: null,
    revisionError,
  };
}
