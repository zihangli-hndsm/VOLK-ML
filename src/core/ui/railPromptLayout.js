const AVATAR_PROMPT_GAP = 32;

export function resolveRailPromptLayout({ railTop, railLeft = 0, railHeight, avatarTop, avatarRight = 0, avatarHeight, promptHeight, controlsTop, safeInset = 8 }) {
  const safe = Math.max(0, Math.min(safeInset, railHeight / 4));
  const controlsRelativeTop = Math.max(safe, controlsTop - railTop);
  const availableHeight = Math.max(0, controlsRelativeTop - safe - safeInset);
  const maxHeight = Math.max(48, availableHeight);
  const visiblePromptHeight = Math.min(promptHeight, maxHeight);
  const maximumTop = Math.max(safe, controlsRelativeTop - visiblePromptHeight - safeInset);
  const desiredTop = avatarTop + avatarHeight / 2 - railTop - visiblePromptHeight / 2;
  return Object.freeze({
    left: Math.max(safeInset, avatarRight - railLeft + AVATAR_PROMPT_GAP),
    top: Math.max(safe, Math.min(maximumTop, desiredTop)),
    maxHeight,
    compact: promptHeight > maxHeight,
  });
}
