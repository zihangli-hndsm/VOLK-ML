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
