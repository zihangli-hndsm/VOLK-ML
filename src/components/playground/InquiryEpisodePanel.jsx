import { useEffect, useState } from 'react';

export default function InquiryEpisodePanel({ snapshot, host, onDispatch, t }) {
  const [expectation, setExpectation] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [saved, setSaved] = useState(false);
  const [reflectionText, setReflectionText] = useState('');
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const runtime = snapshot?.inquiryRuntime;
  useEffect(() => { if (runtime?.prediction) setSaved(true); }, [runtime?.prediction]);
  useEffect(() => { if (runtime?.reflection) { setReflectionText(runtime.reflection.text ?? ''); setReflectionSaved(true); } }, [runtime?.reflection]);
  if (!runtime) return null;
  const evidence = runtime.evidence;
  const compare = runtime.comparison;
  const baselineFit = runtime.baseline?.fit;
  const activeFit = runtime.activeFit;
  const range = snapshot?.scene?.ranges ?? { xMin: -2, xMax: 2, yMin: -3, yMax: 4 };
  const fitLine = (fit) => {
    if (!fit || !Number.isFinite(fit.weight) || !Number.isFinite(fit.bias)) return null;
    const xSpan = Math.max(0.001, range.xMax - range.xMin);
    const ySpan = Math.max(0.001, range.yMax - range.yMin);
    return { x1: 4, x2: 296, y1: 96 - ((fit.weight * range.xMin + fit.bias - range.yMin) / ySpan) * 88, y2: 96 - ((fit.weight * range.xMax + fit.bias - range.yMin) / ySpan) * 88, xSpan };
  };
  const dispatch = async (action) => {
    if (action.type === 'SAMPLE_SAME_WORLD') {
      await onDispatch({ type: 'DUPLICATE_EXPERIMENT' });
      await onDispatch({ type: 'RESAMPLE_WORLD' });
      return;
    }
    await onDispatch(action);
  };
  const savePrediction = async (skipped = false) => {
    await host.recordInquiryPrediction({ expectation: skipped ? undefined : expectation, reasoning, skipped });
    setSaved(true);
  };
  return <section data-inquiry-episode={runtime.contractId} className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 text-sm text-slate-800">
    <p className="text-xs font-black uppercase tracking-wide text-indigo-700">{t('episode.one.title')}</p>
    <h3 className="mt-1 font-black">{t(runtime.currentQuestion)}</h3>
    {!saved && <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-600">{t('episode.one.prediction')}</p>
      <div className="flex flex-wrap gap-2">{['same', 'different', 'unsure'].map((choice) => <button key={choice} type="button" onClick={() => setExpectation(choice)} className={`rounded-xl border px-2.5 py-1.5 text-xs font-bold ${expectation === choice ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white'}`}>{t(`episode.one.prediction.${choice}`)}</button>)}</div>
      <textarea value={reasoning} maxLength={240} onChange={(event) => setReasoning(event.target.value)} placeholder={t('episode.one.orientation')} className="w-full rounded-xl border border-slate-200 bg-white p-2 text-xs" />
      <div className="flex gap-2"><button type="button" disabled={!expectation} onClick={() => savePrediction()} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40">{t('episode.one.prediction.save')}</button><button type="button" onClick={() => savePrediction(true)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold">{t('episode.one.prediction.skip')}</button></div>
    </div>}
    {!saved && <div className="mt-3 rounded-xl border border-indigo-100 bg-white/70 p-3 text-xs text-slate-600"><p className="font-black text-indigo-700">{t('episode.one.onboarding.title')}</p><p className="mt-1">{t('episode.one.onboarding.body')}</p><p className="mt-1 text-slate-500">{t('episode.one.onboarding.invitation')}</p></div>}
    <div className="mt-3 grid gap-2 sm:grid-cols-4">
      <button type="button" onClick={() => dispatch({ type: 'RUN' })} className="rounded-xl bg-white px-2 py-2 text-xs font-black shadow-sm">{t('episode.one.fitA')}</button>
      <button type="button" onClick={() => dispatch({ type: 'SAMPLE_SAME_WORLD' })} className="rounded-xl bg-white px-2 py-2 text-xs font-black shadow-sm">{t('episode.one.sample')}</button>
      <button type="button" onClick={() => dispatch({ type: 'RUN' })} className="rounded-xl bg-white px-2 py-2 text-xs font-black shadow-sm">{t('episode.one.fitB')}</button>
      <button type="button" disabled={!snapshot?.experimentWorkspace?.comparison?.againstExperimentId} onClick={() => dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: snapshot.experimentWorkspace.comparison.againstExperimentId })} className="rounded-xl bg-white px-2 py-2 text-xs font-black shadow-sm disabled:opacity-40">{t('episode.one.compare')}</button>
    </div>
    {compare?.enabled && evidence?.status !== 'insufficient' && <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl bg-white p-2"><p className="text-[10px] font-black uppercase text-emerald-700">{t('episode.one.changed')}</p><p className="mt-1 text-xs">{evidence.evidence?.changed?.join(' · ')}</p></div>
      <div className="rounded-xl bg-white p-2"><p className="text-[10px] font-black uppercase text-slate-600">{t('episode.one.held')}</p><p className="mt-1 text-xs">{evidence.evidence?.held?.join(' · ')}</p></div>
      <div className="rounded-xl bg-white p-2"><p className="text-[10px] font-black uppercase text-indigo-700">{t('episode.one.observed')}</p><p className="mt-1 text-xs">{evidence.evidence?.observed?.lineMovement ?? evidence.status}</p></div>
    </div>}
    {compare?.enabled && evidence?.status !== 'insufficient' && <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold" aria-label={t('episode.one.fittedLines')}><span><span className="mr-1 inline-block h-0.5 w-6 bg-blue-600 align-middle" />A</span><span><span className="mr-1 inline-block h-0.5 w-6 border-t-2 border-dashed border-violet-600 align-middle" />B</span></div>}
    {compare?.enabled && baselineFit && activeFit && <div data-episode-fit-overlay className="mt-3 rounded-xl border border-slate-200 bg-white p-2"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t('episode.one.compareOverlay')}</p><svg viewBox="0 0 300 110" className="mt-1 block h-24 w-full" role="img" aria-label={t('episode.one.fittedLines')}><line x1="4" y1="96" x2="296" y2="96" stroke="#cbd5e1" /><line x1="4" y1="8" x2="4" y2="96" stroke="#cbd5e1" />{fitLine(baselineFit) && <line x1={fitLine(baselineFit).x1} y1={fitLine(baselineFit).y1} x2={fitLine(baselineFit).x2} y2={fitLine(baselineFit).y2} stroke="#2563eb" strokeWidth="3" />} {fitLine(activeFit) && <line x1={fitLine(activeFit).x1} y1={fitLine(activeFit).y1} x2={fitLine(activeFit).x2} y2={fitLine(activeFit).y2} stroke="#7c3aed" strokeWidth="3" strokeDasharray="8 5" />}</svg><div className="flex flex-wrap gap-3 text-[11px] font-bold"><span><span className="mr-1 inline-block h-0.5 w-6 bg-blue-600 align-middle" />{t('episode.one.fitAReference')}</span><span><span className="mr-1 inline-block h-0.5 w-6 border-t-2 border-dashed border-violet-600 align-middle" />{t('episode.one.fitBCurrent')}</span></div></div>}
    {runtime.candidateConcepts.includes('SAMPLING_VARIABILITY') && <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black">{t('playground.inquiry.samplingVariability.title')}</p><span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-black uppercase text-indigo-700">{t('episode.one.concept.evidenced')}</span></div><p className="mt-1 text-xs">{t('playground.inquiry.samplingVariability.definition')}</p><p className="mt-1 text-xs text-slate-600">{t('playground.inquiry.samplingVariability.summary')}</p><p data-concept-relationship="world-sampling-data-learning-model" className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-950">{t('playground.concept.samplingRelationship')}</p><p className="mt-2 text-[11px] text-slate-500">{t('episode.one.concept.encountered')}</p></div>}
    {runtime.candidateConcepts.includes('SAMPLING_VARIABILITY') && !reflectionSaved && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><p className="font-black">{t('episode.one.reflection.title')}</p><p className="mt-1 text-xs text-slate-600">{t('episode.one.reflection.body')}</p><textarea value={reflectionText} maxLength={240} onChange={(event) => setReflectionText(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-2 text-xs" placeholder={t('episode.one.reflection.placeholder')} /><div className="mt-2 flex gap-2"><button type="button" disabled={!reflectionText.trim()} onClick={async () => { await host.recordInquiryReflection({ text: reflectionText }); setReflectionSaved(true); }} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40">{t('episode.one.reflection.save')}</button><button type="button" onClick={async () => { await host.recordInquiryReflection({ skipped: true }); setReflectionSaved(true); }} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold">{t('episode.one.reflection.skip')}</button></div></div>}
    {runtime.continuations?.length > 0 && runtime.candidateConcepts.includes('SAMPLING_VARIABILITY') && <div className="mt-3 flex flex-wrap gap-2">{runtime.continuations.map((item) => <button key={item.id} type="button" onClick={() => host.recordInquiryContinuation?.(item.id)} className="rounded-xl border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-bold">{t(item.questionKey)}</button>)}</div>}
  </section>;
}
