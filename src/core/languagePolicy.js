// Project language application policy.
//
// - 'project': a project that carries a language preference restores it
//   (existing Import/Restore/Agent loadProject behavior).
// - 'preserve-current': bundled examples must never change the user's UI
//   preference, so the project language is ignored entirely.
//
// The function is pure so the policy is unit-testable without a browser.
export function resolveLanguagePreference({
  projectPrimary,
  projectSecondary,
  currentPrimary,
  currentSecondary,
  policy = 'project',
}) {
  if (policy === 'preserve-current') {
    return {
      primary: currentPrimary,
      secondary: currentSecondary,
      apply: false,
    };
  }
  return {
    primary: projectPrimary ?? currentPrimary,
    secondary: projectSecondary ?? currentSecondary,
    apply: Boolean(projectPrimary),
  };
}
