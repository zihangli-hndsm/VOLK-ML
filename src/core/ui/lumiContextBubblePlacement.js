const DEFAULT_INSET = 8;
const DEFAULT_GAP = 12;

function rect(value = {}) {
  const left = Number(value.left ?? value.x ?? 0);
  const top = Number(value.top ?? value.y ?? 0);
  const width = Math.max(0, Number(value.width ?? 0));
  const height = Math.max(0, Number(value.height ?? 0));
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isInside(value, bounds) {
  return value.left >= bounds.left && value.top >= bounds.top
    && value.right <= bounds.right && value.bottom <= bounds.bottom;
}

export function resolveLumiContextBubblePlacement({ viewport, anchor, bubble, inset = DEFAULT_INSET, gap = DEFAULT_GAP }) {
  const visual = rect(viewport);
  const bounds = {
    left: visual.left + inset,
    top: visual.top + inset,
    right: visual.right - inset,
    bottom: visual.bottom - inset,
  };
  const avatar = rect(anchor);
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const width = Math.min(Math.max(1, Number(bubble?.width ?? 1)), availableWidth);
  const height = Math.min(Math.max(1, Number(bubble?.height ?? 1)), availableHeight);
  const candidates = [
    { id: 'above-right', left: avatar.right - width, top: avatar.top - gap - height },
    { id: 'above-left', left: avatar.left, top: avatar.top - gap - height },
    { id: 'left', left: avatar.left - gap - width, top: avatar.top + (avatar.height - height) / 2 },
    { id: 'right', left: avatar.right + gap, top: avatar.top + (avatar.height - height) / 2 },
    { id: 'below-right', left: avatar.right - width, top: avatar.bottom + gap },
  ].map((candidate) => ({ ...candidate, right: candidate.left + width, bottom: candidate.top + height, width, height }));

  const selected = candidates.find((candidate) => isInside(candidate, bounds) && !overlaps(candidate, avatar));
  if (selected) return { ...selected, maxWidth: availableWidth, maxHeight: availableHeight, visible: true };

  // If the prompt is taller than the free space above the character, constrain
  // its scrolling region to that space instead of allowing it to collide.
  const aboveHeight = Math.min(height, Math.max(1, avatar.top - gap - bounds.top));
  const constrained = {
    id: 'above-constrained',
    left: Math.max(bounds.left, Math.min(avatar.right - width, bounds.right - width)),
    top: avatar.top - gap - aboveHeight,
    right: 0,
    bottom: avatar.top - gap,
    width,
    height: aboveHeight,
  };
  constrained.right = constrained.left + constrained.width;
  if (constrained.height >= 24 && isInside(constrained, bounds) && !overlaps(constrained, avatar)) {
    return { ...constrained, maxWidth: availableWidth, maxHeight: constrained.height, visible: true };
  }

  return { id: 'hidden-no-safe-space', left: bounds.left, top: bounds.top, width: 0, height: 0, maxWidth: availableWidth, maxHeight: availableHeight, visible: false };
}

export const LUMI_CONTEXT_BUBBLE_LAYOUT = Object.freeze({ inset: DEFAULT_INSET, gap: DEFAULT_GAP });
