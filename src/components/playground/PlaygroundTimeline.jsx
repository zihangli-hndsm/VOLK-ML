// Timeline drives the active playback. When a Visualization Script is loaded
// (the default on open), the script timeline is authoritative and script
// steps are never conflated with model training/reveal steps. Without a
// script, the model timeline drives playback.
export default function PlaygroundTimeline({ snapshot, onDispatch, t }) {
  const script = snapshot.scriptState?.totalSteps > 0 ? snapshot.scriptState : null;
  const totalSteps = script ? script.totalSteps : snapshot.timeline.totalSteps;
  const step = script ? script.step : snapshot.timeline.step;
  const playing = script ? script.status === 'playing' : snapshot.status === 'playing';
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
    <button disabled={!snapshot.capabilities.canReset} onClick={() => onDispatch(script ? { type: 'SCRIPT_RESET' } : { type: 'RESET' })}
      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('playground.timeline.reset')}</button>
    <button disabled={!snapshot.capabilities.canPlay} onClick={() => onDispatch(playing ? (script ? { type: 'SCRIPT_PAUSE' } : { type: 'PAUSE' }) : (script ? { type: 'SCRIPT_PLAY' } : { type: 'PLAY' }))}
      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{playing ? t('playground.timeline.pause') : t('playground.timeline.play')}</button>
    <button disabled={!snapshot.capabilities.canStep} onClick={() => onDispatch(script ? { type: 'SCRIPT_STEP' } : { type: 'STEP' })}
      className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('playground.timeline.step')}</button>
    <input type="range" min={0} max={totalSteps || 1} value={Math.min(step, totalSteps || 1)} disabled={!snapshot.capabilities.canSeek}
      onChange={(event) => onDispatch(script ? { type: 'SCRIPT_SEEK', step: Number(event.target.value) } : { type: 'SEEK', step: Number(event.target.value) })}
      className="min-w-28 flex-1 accent-blue-600" />
    <span className="font-mono text-xs font-bold text-slate-600">{step}{totalSteps ? ` / ${totalSteps}` : ''}</span>
    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
      <span>{t('playground.timeline.speed')}</span>
      <select value={snapshot.timeline.speed} onChange={(event) => onDispatch({ type: 'SET_SPEED', value: Number(event.target.value) })}
        className="rounded-lg border bg-white px-2 py-1">
        {[0.5, 1, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
      </select>
    </label>
  </div>;
}
