import { useState } from 'react';
import InstructionalAnnotationSurface from './InstructionalAnnotationSurface.jsx';
import Lumi from './Lumi.jsx';

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—';
}

function value(value, type) {
  if (type === 'range') return value ? `[${number(value.min)}, ${number(value.max)}]` : '—';
  if (type === 'coverage') return value ? `test outside train ${(value.testOutsideTrainFraction * 100).toFixed(0)}%; overlap ${(value.overlapWidth).toFixed(3)}` : '—';
  if (typeof value === 'string') return value;
  return number(value);
}

const rows = [
  'world.trainSampleCount', 'world.testSampleCount', 'world.trainXRange', 'world.testXRange',
  'world.generatorNoise', 'world.outlierCount', 'model.slope', 'model.bias',
  'outcome.trainMse', 'outcome.testMse', 'learning.currentStep', 'generalizationGap', 'coverageMismatch',
];

export default function ExplorationEvidence({ snapshot, t, openByDefault = false, agent, onAskAbout, attention = null }) {
  const [open, setOpen] = useState(openByDefault);
  const [dismissed, setDismissed] = useState([]);
  const notices = (snapshot.observations ?? []).filter((item) => !dismissed.includes(item.id));
  const available = rows.filter((id) => snapshot.observables?.[id]?.available || snapshot.derivedObservables?.[id]?.available);
  const repeat = snapshot.repeatEvidence;
  if (!available.length && !notices.length && !repeat) return null;
  const read = (id) => snapshot.observables?.[id] ?? snapshot.derivedObservables?.[id];
  const messageParams = (notice) => {
    const e = notice.evidence ?? {};
    return Object.fromEntries(Object.entries(e).map(([key, item]) => [key, typeof item === 'number' ? number(item) : item]));
  };
  return <InstructionalAnnotationSurface surface="evidence" contentId={`evidence-${snapshot.experimentWorkspace?.activeExperimentId ?? snapshot.playgroundId}`} messageId={`evidence-${snapshot.experimentWorkspace?.activeExperimentId ?? snapshot.playgroundId}`} localizationKey="playground.evidence.ariaLabel" agent={agent} onAskAbout={onAskAbout} t={t}>
    <section className="rounded-2xl border border-slate-200 bg-white p-3" aria-label={t('playground.evidence.ariaLabel')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><Lumi presence="contextual" mode={attention?.evidenceTarget ? 'observe' : 'idle'} /><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-sm font-black text-slate-900">{t('playground.evidence.title')}</button></div>
      <span className="text-xs font-bold text-slate-500">{notices.length ? t('playground.evidence.noticeCount', { count: notices.length }) : t('playground.evidence.quiet')}</span>
    </div>
    {notices.length > 0 && <div className="mt-3 space-y-2" aria-live="polite">
      {notices.slice(0, 3).map((notice) => <div key={notice.id} role="status" data-lumi-target={`evidence:${notice.id}`} data-evidence-kind="observation" className="flex items-start justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-950">
        <p><span className="font-black">{t(`playground.evidence.severity.${notice.severity}`)}</span> {t(notice.messageKey, messageParams(notice))}</p>
        <button type="button" aria-label={t('playground.evidence.dismiss')} onClick={() => setDismissed((items) => [...items, notice.id])} className="shrink-0 rounded-lg px-2 py-1 font-black hover:bg-cyan-100">×</button>
      </div>)}
    </div>}
    {open && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {available.map((id) => {
        const item = read(id);
        const focused = snapshot.visualState?.evidenceFocus?.includes(id);
        return <div key={id} data-evidence-kind="observation" className={`rounded-xl bg-slate-50 p-2 text-xs${focused ? ' ring-2 ring-cyan-400 ring-offset-1' : ''}`}><span className="block font-bold text-slate-500">{t(item.labelKey)}</span><span className="font-mono font-black text-slate-800">{value(item.value, item.valueType)}</span></div>;
      })}
      {repeat && <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs sm:col-span-2 lg:col-span-3">
        <p className="font-black text-blue-900">{t('playground.evidence.repeatTitle', { count: repeat.trialCount })}</p>
        <p className="mt-1 text-blue-800">{t('playground.evidence.seedPolicy')}: {repeat.seedPolicy}; {t('playground.evidence.baseSeed')}: {repeat.baseSeed ?? '—'}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[['slope', 'playground.evidence.slope'], ['bias', 'playground.evidence.bias'], ['trainMse', 'playground.evidence.trainMse'], ['testMse', 'playground.evidence.testMse']].map(([key, label]) => {
          const aggregate = repeat.aggregates?.[key];
          return <div key={key} className="rounded-lg bg-white/80 p-2"><span className="block font-bold text-slate-500">{t(label)}</span><span className="font-mono font-black text-slate-800">{aggregate ? `${number(aggregate.mean)} [${number(aggregate.min)}, ${number(aggregate.max)}]` : '—'}</span></div>;
        })}</div>
      </div>}
    </div>}
    </section>
  </InstructionalAnnotationSurface>;
}
