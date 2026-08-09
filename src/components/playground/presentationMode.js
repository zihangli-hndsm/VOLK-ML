export const PRESENTATION_STAGE_ASPECT_RATIO = 16 / 9;
export const PRESENTATION_MAX_STAGE_WIDTH = 1280;

export function fitPresentationStage({
  areaWidth,
  areaHeight,
  contentHeight = 0,
  gap = 0,
  maxWidth = PRESENTATION_MAX_STAGE_WIDTH,
} = {}) {
  const width = Number.isFinite(areaWidth) ? Math.max(0, areaWidth) : 0;
  const height = Number.isFinite(areaHeight) ? Math.max(0, areaHeight) : 0;
  const teachingContentHeight = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const contentGap = teachingContentHeight > 0 && Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const availableHeight = Math.max(0, height - teachingContentHeight - contentGap);
  const stageWidth = Math.min(
    width,
    Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : PRESENTATION_MAX_STAGE_WIDTH,
    availableHeight * PRESENTATION_STAGE_ASPECT_RATIO,
  );
  return {
    width: stageWidth,
    height: stageWidth / PRESENTATION_STAGE_ASPECT_RATIO,
    availableHeight,
  };
}

export function hasScriptPlayback(snapshot) {
  return Boolean(snapshot?.scriptState?.totalSteps > 0);
}

export function getPresentationPlaybackAction(snapshot, command) {
  const scripted = hasScriptPlayback(snapshot);
  const prefix = scripted ? 'SCRIPT_' : '';
  if (command === 'restart') return { type: `${prefix}RESET` };
  if (command === 'play-pause') {
    const playing = scripted
      ? snapshot.scriptState.status === 'playing'
      : snapshot.status === 'playing';
    return { type: `${prefix}${playing ? 'PAUSE' : 'PLAY'}` };
  }
  return null;
}

export function isEditablePresentationTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}
