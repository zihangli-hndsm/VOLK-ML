export default function PlaygroundTimeline({ snapshot, onDispatch, t }) {
  const { status, timeline, capabilities } = snapshot;
  const playing = status === 'playing';
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
    <button disabled={!capabilities.canReset} onClick={() => onDispatch({ type: 'RESET' })}
      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('playground.timeline.reset')}</button>
    <button disabled={!capabilities.canPlay} onClick={() => onDispatch(playing ? { type: 'PAUSE' } : { type: 'PLAY' })}
      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{playing ? t('playground.timeline.pause') : t('playground.timeline.play')}</button>
    <button disabled={!capabilities.canStep} onClick={() => onDispatch({ type: 'STEP' })}
      className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('playground.timeline.step')}</button>
    <input type="range" min={0} max={timeline.totalSteps || 1} value={Math.min(timeline.step, timeline.totalSteps || 1)} disabled={!capabilities.canSeek}
      onChange={(event) => onDispatch({ type: 'SEEK', step: Number(event.target.value) })} className="min-w-28 flex-1 accent-blue-600" />
    <span className="font-mono text-xs font-bold text-slate-600">{timeline.step}{timeline.totalSteps ? ` / ${timeline.totalSteps}` : ''}</span>
    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
      <span>{t('playground.timeline.speed')}</span>
      <select value={timeline.speed} onChange={(event) => onDispatch({ type: 'SET_SPEED', value: Number(event.target.value) })}
        className="rounded-lg border bg-white px-2 py-1">
        {[0.5, 1, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
      </select>
    </label>
  </div>;
}
