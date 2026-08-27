import { useState } from 'react';
import { INTERPRETATION_JUDGMENTS } from '../../core/exploration/learnerInterpretation.js';
import Lumi from './Lumi.jsx';

export default function LearnerInterpretationPanel({ hypotheses = [], evidenceInstances = [], testDesigns = [], interpretations = [], revisions = [], compact = false, t, onCreateInterpretation, onCreateRevision }) {
  const [hypothesisIds, setHypothesisIds] = useState([]);
  const [evidenceIds, setEvidenceIds] = useState([]);
  const [testDesignId, setTestDesignId] = useState('');
  const [judgment, setJudgment] = useState(null);
  const [note, setNote] = useState('');
  const [revisionSource, setRevisionSource] = useState(null);
  const [revisionStatement, setRevisionStatement] = useState('');
  const availableEvidence = evidenceInstances.filter((instance) => instance.available);
  const canCreate = hypothesisIds.length > 0 && evidenceIds.length > 0 && judgment;

  const create = () => {
    const result = onCreateInterpretation?.({ hypothesisIds, evidenceInstanceIds: evidenceIds, testDesignId: testDesignId || null, judgment, note });
    if (result) {
      setEvidenceIds([]);
      setJudgment(null);
      setNote('');
    }
  };
  const createRevision = () => {
    if (!revisionSource || !revisionStatement.trim()) return;
    const result = onCreateRevision?.({ parentHypothesisId: revisionSource.hypothesisIds[0], interpretationIds: [revisionSource.id], statement: revisionStatement });
    if (result) {
      setRevisionSource(null);
      setRevisionStatement('');
    }
  };
  if (hypotheses.length === 0 || evidenceInstances.length === 0) return null;

  return <section data-learner-interpretation="true" className={'rounded-2xl border border-cyan-200 bg-cyan-50/60 p-3 ' + (compact ? 'text-sm' : '')} aria-label={t('playground.interpretation.ariaLabel')}>
    <div className="flex items-start gap-2">
      <Lumi presence="contextual" mode="observe" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('playground.interpretation.kicker')}</p>
        <h3 className="text-sm font-black text-slate-950">{t('playground.interpretation.title')}</h3>
        <p className="mt-1 text-xs text-cyan-950">{t('playground.interpretation.boundary')}</p>
      </div>
    </div>
    <fieldset className="mt-3 rounded-xl border border-cyan-200 bg-white p-3">
      <legend className="px-1 text-xs font-black text-slate-900">{t('playground.interpretation.chooseHypotheses')}</legend>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">{hypotheses.map((hypothesis) => <label key={hypothesis.id} className="flex min-w-0 items-start gap-2 rounded-lg border border-cyan-100 bg-cyan-50/50 px-2 py-2 text-xs text-slate-800"><input type="checkbox" checked={hypothesisIds.includes(hypothesis.id)} onChange={(event) => setHypothesisIds((current) => event.target.checked ? [...new Set([...current, hypothesis.id])] : current.filter((id) => id !== hypothesis.id))} className="mt-1 accent-cyan-600" /><span className="break-words">{hypothesis.statement}</span></label>)}</div>
    </fieldset>
    <fieldset className="mt-2 rounded-xl border border-cyan-200 bg-white p-3">
      <legend className="px-1 text-xs font-black text-slate-900">{t('playground.interpretation.chooseEvidence')}</legend>
      <div className="mt-1 space-y-2">{availableEvidence.map((instance) => <label key={instance.id} className="flex min-w-0 items-start gap-2 rounded-lg border border-cyan-100 px-2 py-2 text-xs text-slate-800"><input type="checkbox" checked={evidenceIds.includes(instance.id)} onChange={(event) => setEvidenceIds((current) => event.target.checked ? [...new Set([...current, instance.id])] : current.filter((id) => id !== instance.id))} className="mt-1 accent-cyan-600" /><span className="break-words">{instance.messageKey ? t(instance.messageKey) : instance.reasonCode}</span></label>)}</div>
      {availableEvidence.length === 0 && <p className="text-xs text-slate-600">{t('playground.interpretation.noEvidence')}</p>}
    </fieldset>
    {testDesigns.length > 0 && <label className="mt-2 block text-[11px] font-black text-slate-700" htmlFor="interpretation-test-design">{t('playground.interpretation.testDesign')}</label>}
    {testDesigns.length > 0 && <select id="interpretation-test-design" value={testDesignId} onChange={(event) => setTestDesignId(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-cyan-200 bg-white px-2 text-xs text-slate-900"><option value="">{t('playground.interpretation.noTestDesign')}</option>{testDesigns.map((design) => <option key={design.id} value={design.id}>{design.intervention?.semanticPath ?? design.id}</option>)}</select>}
    <fieldset className="mt-2 rounded-xl border border-cyan-200 bg-white p-3">
      <legend className="px-1 text-xs font-black text-slate-900">{t('playground.interpretation.judgmentLabel')}</legend>
      <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">{INTERPRETATION_JUDGMENTS.map((choice) => <button key={choice} type="button" aria-pressed={judgment === choice} onClick={() => setJudgment(choice)} className={'rounded-lg border px-2 py-2 text-[10px] font-black ' + (judgment === choice ? 'border-cyan-600 bg-cyan-200 text-cyan-950' : 'border-cyan-100 bg-white text-slate-700')}>{t('playground.interpretation.judgment.' + choice)}</button>)}</div>
    </fieldset>
    <label className="mt-2 block text-[11px] font-black text-slate-700" htmlFor="learner-interpretation-note">{t('playground.interpretation.noteLabel')}</label>
    <textarea id="learner-interpretation-note" value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder={t('playground.interpretation.notePlaceholder')} className="mt-1 min-h-16 w-full resize-y rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
    <button type="button" disabled={!canCreate} onClick={create} className="mt-2 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{t('playground.interpretation.save')}</button>
    {interpretations.length > 0 && <div className="mt-3 space-y-2" role="list" aria-label={t('playground.interpretation.historyLabel')}>
      {interpretations.map((interpretation) => <article key={interpretation.id} role="listitem" className="rounded-xl border border-cyan-200 bg-white p-3"><p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('playground.interpretation.yourInterpretation')}</p><p className="mt-1 text-xs font-bold text-slate-800">{t('playground.interpretation.judgment.' + interpretation.judgment)}</p>{interpretation.note && <p className="mt-1 break-words text-xs text-slate-700">{interpretation.note}</p>}<button type="button" onClick={() => { setRevisionSource(interpretation); setRevisionStatement(''); }} className="mt-2 rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 text-[10px] font-black text-purple-900">{t('playground.interpretation.revise')}</button></article>)}
    </div>}
    {revisionSource && <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3"><p className="text-xs font-black text-purple-950">{t('playground.interpretation.revisionTitle')}</p><textarea value={revisionStatement} maxLength={240} onChange={(event) => setRevisionStatement(event.target.value)} placeholder={t('playground.interpretation.revisionPlaceholder')} className="mt-2 min-h-16 w-full rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs text-slate-900" /><button type="button" disabled={!revisionStatement.trim()} onClick={createRevision} className="mt-2 rounded-xl bg-purple-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{t('playground.interpretation.createRevision')}</button></div>}
    {revisions.length > 0 && <p className="mt-2 text-[11px] text-purple-900">{t('playground.interpretation.revisionCount', { count: revisions.length })}</p>}
  </section>;
}
