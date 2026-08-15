import { isCompactPresentationWidth } from './uiArchitecture.js';

export const DEFAULT_BUILD_RIGHT_WIDTH = 300;

export function createBuildPanelPresentation({
  viewportWidth,
  leftOpen = true,
  rightOpen = true,
  rightWidth = DEFAULT_BUILD_RIGHT_WIDTH,
} = {}) {
  const compact = isCompactPresentationWidth(viewportWidth);
  return Object.freeze({
    compact,
    leftOpen: compact ? false : Boolean(leftOpen),
    rightOpen: compact ? false : Boolean(rightOpen),
    rightWidth: Number.isFinite(Number(rightWidth)) ? Number(rightWidth) : DEFAULT_BUILD_RIGHT_WIDTH,
  });
}

export function toggleBuildPanel(presentation, panel) {
  if (!['left', 'right'].includes(panel)) throw new TypeError(`Unknown Build panel: ${String(panel)}`);
  const key = panel === 'left' ? 'leftOpen' : 'rightOpen';
  const otherKey = panel === 'left' ? 'rightOpen' : 'leftOpen';
  const nextOpen = !presentation[key];
  return Object.freeze({
    ...presentation,
    [key]: nextOpen,
    [otherKey]: presentation.compact && nextOpen ? false : presentation[otherKey],
  });
}
