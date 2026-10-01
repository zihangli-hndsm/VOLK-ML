export const INTRO_PREFERENCE_VERSION = 1;
export const INTRO_PREFERENCE_KEY = 'volk.ml.intro-preference.v1';
export const INTRO_ENTRY_IDS = Object.freeze(['episode-1-sampling-variability', 'free-exploration']);

const validEntry = (value) => INTRO_ENTRY_IDS.includes(value) ? value : null;

export function normalizeIntroPreference(value) {
  if (!value || value.version !== INTRO_PREFERENCE_VERSION) {
    return Object.freeze({ version: INTRO_PREFERENCE_VERSION, dismissed: false, lastEntryId: null });
  }
  return Object.freeze({
    version: INTRO_PREFERENCE_VERSION,
    dismissed: value.dismissed === true,
    lastEntryId: validEntry(value.lastEntryId),
  });
}

export function readIntroPreference(storage = null) {
  try {
    const source = storage ?? globalThis.localStorage;
    const serialized = source?.getItem(INTRO_PREFERENCE_KEY);
    return normalizeIntroPreference(serialized ? JSON.parse(serialized) : null);
  } catch {
    return normalizeIntroPreference(null);
  }
}

export function writeIntroPreference(value, storage = null) {
  const normalized = normalizeIntroPreference(value);
  try {
    const destination = storage ?? globalThis.localStorage;
    destination?.setItem(INTRO_PREFERENCE_KEY, JSON.stringify(normalized));
  } catch {
    // Intro preference is a convenience only; storage failures never block Explore.
  }
  return normalized;
}

export function markIntroDismissed(preference, lastEntryId = preference?.lastEntryId ?? null) {
  return normalizeIntroPreference({
    version: INTRO_PREFERENCE_VERSION,
    dismissed: true,
    lastEntryId: validEntry(lastEntryId),
  });
}

export function rememberIntroEntry(preference, entryId) {
  return normalizeIntroPreference({
    version: INTRO_PREFERENCE_VERSION,
    dismissed: preference?.dismissed === true,
    lastEntryId: validEntry(entryId),
  });
}
