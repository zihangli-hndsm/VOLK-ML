export const COMPACT_SHEET_DISMISS_THRESHOLD = 80;

export function resolveCompactSheetGesture({ deltaY, scrollTop = 0, startedFromHandle = false, threshold = COMPACT_SHEET_DISMISS_THRESHOLD } = {}) {
  if (!(deltaY > 0)) return { claimed: false, dismiss: false };
  if (!startedFromHandle && scrollTop > 0) return { claimed: false, dismiss: false };
  return { claimed: true, dismiss: deltaY >= threshold };
}
