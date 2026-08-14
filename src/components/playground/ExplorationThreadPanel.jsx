import { useMemo, useState } from 'react';

function fallbackLabel(id) {
  return String(id).split('.').at(-1).replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function compactValue(value) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') return Number(value).toFixed(3);
  return String(value);
}

function sideLabel(side, t) {
  const key = {
    active: 'playground.thread.side.active',
    baseline: 'playground.thread.side.baseline',
  }[side];
  return key ? t(key) : side;
}

export default function ExplorationThreadPanel({ agent, snapshot, t }) {
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [prediction, setPrediction] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const active = snapshot?.activeExplorationThread;
  const threads = snapshot?.explorationThreads ?? [];
  const workspaceIds = useMemo(() => new Set((snapshot?.experimentWorkspace?.experiments ?? []).map((item) => item.id)), [snapshot?.experimentWorkspace?.experiments]);
  const observableMetadata = useMemo(() => ({ ...(snapshot?.observables ?? {}), ...(snapshot?.derivedObservables ?? {}) }), [snapshot?.observables, snapshot?.derivedObservables]);

  const call = async (operation) => {
    setError(null);
    try { await operation(); } catch (caught) { setError(caught); }
  };
  const start = () => call(() => { agent.createExplorationThread({ title: title.trim() || question.trim() || undefined, question: question.trim() || undefined, actor: 'human', source: 'manual' }); setTitle(''); setQuestion(''); });
  const addQuestion = () => call(() => { agent.addExplorationThreadQuestion({ text: question.trim(), actor: 'human', source: 'manual' }); setQuestion(''); });
  const addPrediction = () => call(() => { agent.addExplorationThreadPrediction({ text: prediction.trim(), actor: 'human' }); setPrediction(''); });
  const recordExperiment = () => call(() => agent.recordExplorationThreadExperiment());
  const recordObservation = () => call(() => { agent.recordExplorationThreadObservation({ note: note.trim() || undefined }); setNote(''); });

  return <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3" aria-label={t('playground.thread.ariaLabel')}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-cyan-800">{t('playground.thread.title')}</p>
        <p className="mt-1 text-xs text-slate-600">{t('playground.thread.subtitle')}</p>
      </div>
      {threads.length > 0 && <label className="text-xs font-bold text-slate-600"><span className="sr-only">{t('playground.thread.select')}</span><select value={active?.id ?? ''} onChange={(event) => call(() => agent.setActiveExplorationThread(event.target.value || null))} className="max-w-full rounded-lg border border-cyan-200 bg-white px-2 py-1"><option value="">{t('playground.thread.noneActive')}</option>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></label>}
    </div>
    {!active && <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto]">
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('playground.thread.titlePlaceholder')} aria-label={t('playground.thread.titlePlaceholder')} className="min-w-0 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500" />
      <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('playground.thread.questionPlaceholder')} aria-label={t('playground.thread.questionPlaceholder')} className="min-w-0 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500" />
      <button type="button" onClick={start} disabled={!title.trim() && !question.trim()} className="rounded-xl bg-cyan-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">{t('playground.thread.start')}</button>
    </div>}
    {active && <>
      <div className="mt-3 rounded-xl border border-cyan-200 bg-white p-3">
        <h3 className="font-black text-slate-900">{active.title}</h3>
        <ol className="mt-2 space-y-2" aria-label={t('playground.thread.history')}>
          {active.entries.length === 0 && <li className="text-xs text-slate-500">{t('playground.thread.empty')}</li>}
          {active.entries.map((entry) => <li key={entry.id} className="rounded-lg bg-slate-50 p-2 text-xs">
            <div className="flex items-start justify-between gap-2"><span className="font-black uppercase tracking-wide text-cyan-800">{t(`playground.thread.kind.${entry.kind}`)}</span><button type="button" onClick={() => call(() => agent.removeExplorationThreadEntry(entry.id))} className="rounded px-1 font-bold text-slate-500 hover:bg-slate-200" aria-label={t('playground.thread.removeEntry')}>×</button></div>
            {(entry.kind === 'question' || entry.kind === 'prediction') && <p className="mt-1 text-slate-800">{entry.text}</p>}
            {entry.kind === 'experiment' && <><p className="mt-1 text-slate-800">{entry.experimentIds.join(' ↔ ')}</p><p className="mt-1 text-[10px] text-slate-500">{entry.semanticDiff?.changed?.join(', ') || t('playground.thread.noDiff')}</p><button type="button" disabled={entry.experimentIds.some((id) => !workspaceIds.has(id))} onClick={() => call(() => agent.resumeExplorationThreadExperiment(entry.id))} className="mt-2 rounded-lg bg-violet-700 px-2 py-1 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{entry.experimentIds.some((id) => !workspaceIds.has(id)) ? t('playground.thread.unavailable') : t('playground.thread.resume')}</button></>}
            {entry.kind === 'observation' && <><p className="mt-1 font-bold text-slate-700">{t('playground.thread.historical')}</p><div className="mt-1 grid gap-1 sm:grid-cols-2">{Object.entries(entry.evidence?.observables ?? {}).slice(0, 6).map(([id, values]) => { const metadata = observableMetadata[id]; return <span key={id} className="rounded bg-white px-2 py-1 text-[10px] text-slate-700 ring-1 ring-slate-200">{metadata?.labelKey ? t(metadata.labelKey) : fallbackLabel(id)}: {Object.entries(values).map(([side, value]) => `${sideLabel(side, t)} ${compactValue(value)}`).join(' / ')}</span>; })}</div>{entry.note && <p className="mt-1 italic text-slate-600">{entry.note}</p>}</>}
          </li>)}
        </ol>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('playground.thread.nextQuestionPlaceholder')} aria-label={t('playground.thread.nextQuestionPlaceholder')} className="min-w-0 flex-1 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-500" /><button type="button" onClick={addQuestion} disabled={!question.trim()} className="rounded-xl bg-cyan-700 px-2 py-2 text-xs font-black text-white disabled:opacity-40">{t('playground.thread.addQuestion')}</button></div>
        <div className="flex gap-2"><input value={prediction} onChange={(event) => setPrediction(event.target.value)} placeholder={t('playground.thread.predictionPlaceholder')} aria-label={t('playground.thread.predictionPlaceholder')} className="min-w-0 flex-1 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-500" /><button type="button" onClick={addPrediction} disabled={!prediction.trim()} className="rounded-xl bg-cyan-700 px-2 py-2 text-xs font-black text-white disabled:opacity-40">{t('playground.thread.addPrediction')}</button></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={recordExperiment} className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white">{t('playground.thread.recordExperiment')}</button><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('playground.thread.notePlaceholder')} aria-label={t('playground.thread.notePlaceholder')} className="min-w-0 flex-1 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-500" /><button type="button" onClick={recordObservation} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white">{t('playground.thread.recordObservation')}</button></div>
    </>}
    {error && <p role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-800">{error.code ?? 'EXPLORATION_THREAD_FAILED'}</p>}
  </section>;
}
