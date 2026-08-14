import { useState } from 'react';

export default function BigIdeaPrompt({ entry, snapshot, agent, host, onRestart, t }) {
  const [restartError, setRestartError] = useState(false);
  if (!entry || !snapshot?.bigIdea) return null;

  const startThread = () => {
    if (!agent) return;
    agent.createExplorationThread({
      title: t(entry.titleKey),
      question: t(entry.questionKey),
      actor: 'human',
      source: `big-idea:${entry.id}`,
    });
  };
  const restart = async () => {
    setRestartError(false);
    try {
      await onRestart();
    } catch {
      setRestartError(true);
    }
  };

  return <section aria-label={t('bigIdea.questionLabel')} className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wider text-blue-700">{t(entry.titleKey)}</p>
        <h2 className="mt-1 text-lg font-black leading-6 text-slate-950">{t(entry.questionKey)}</h2>
      </div>
      <button type="button" onClick={restart} className="shrink-0 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">{t('bigIdea.restart')}</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {agent && <button type="button" onClick={startThread} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">{t('bigIdea.keep')}</button>}
      <span className="text-xs text-slate-600">{t('bigIdea.openQuestionHint')}</span>
    </div>
    {restartError && <p role="alert" className="mt-2 text-xs font-bold text-red-700">{t('bigIdea.restartError')}</p>}
  </section>;
}
