import { useState } from 'react';

function changeLabel(change, t) {
  const keys = {
    outliers: 'playground.explorationAgent.changeOutliers',
    'test-input-support': 'playground.explorationAgent.changeTestSupport',
    noise: 'playground.explorationAgent.changeNoise',
    'observation-values': 'playground.explorationAgent.changeValues',
  };
  return keys[change.semanticTarget] ? t(keys[change.semanticTarget]) : change.semanticTarget ?? change.operation;
}

function diffLabel(diff, t) {
  return diff?.changed?.length ? diff.changed.join(', ') : t('playground.explorationAgent.none');
}

export default function ExplorationAgentPanel({ agent, snapshot, t }) {
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (intent) => {
    if (!request.trim() || busy) return;
    setBusy(true);
    setError(null);
    setRunResult(null);
    try {
      const next = await agent.proposeExploration(intent ? { request, intent } : { request });
      setProposal(next);
    } catch (caught) {
      setError(caught);
      setProposal(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (proposal?.kind !== 'proposal' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await agent.executeExploration(proposal.scenario);
      setRunResult(result);
      setProposal(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const scenario = proposal?.scenario;
  return <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-label={t('playground.explorationAgent.ariaLabel')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-violet-700">{t('playground.explorationAgent.title')}</p>
        <p className="mt-1 text-sm font-bold text-slate-800">{t('playground.explorationAgent.subtitle')}</p>
      </div>
      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-violet-700">{t('playground.explorationAgent.semanticBadge')}</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <input
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') ask(); }}
        placeholder={t('playground.explorationAgent.placeholder')}
        className="min-w-0 flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
      />
      <button type="button" disabled={!request.trim() || busy} onClick={() => ask()} className="rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
        {busy ? t('playground.explorationAgent.working') : t('playground.explorationAgent.ask')}
      </button>
    </div>
    {proposal?.kind === 'clarification' && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
      <p className="font-black">{t('playground.explorationAgent.clarify')}</p>
      <div className="mt-2 flex flex-wrap gap-2">{(proposal.interpretation.choices ?? []).map((choice) => <button type="button" key={choice.id} onClick={() => ask(choice.id)} className="rounded-lg bg-white px-2 py-1 font-bold text-amber-900 ring-1 ring-amber-200">{choice.label}</button>)}</div>
    </div>}
    {scenario && <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3 text-xs">
      <p className="font-black text-violet-800">{t('playground.explorationAgent.proposalTitle')}</p>
      <p className="mt-1 text-slate-600">{scenario.interpretation.summary}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div><p className="font-black uppercase tracking-wider text-rose-600">{t('playground.explorationAgent.change')}</p><ul className="mt-1 space-y-1 text-slate-700">{scenario.change.map((change, index) => <li key={`${change.operation}-${index}`}>• {changeLabel(change, t)}</li>)}</ul></div>
        <div><p className="font-black uppercase tracking-wider text-emerald-600">{t('playground.explorationAgent.hold')}</p><p className="mt-1 text-slate-700">{scenario.hold.join(', ')}</p></div>
        <div><p className="font-black uppercase tracking-wider text-blue-600">{t('playground.explorationAgent.observe')}</p><p className="mt-1 text-slate-700">{scenario.observe.join(', ')}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-2 py-1 font-black text-emerald-800">{t('playground.explorationAgent.fidelity')}: {scenario.fidelity.status}</span>
        <button type="button" disabled={busy} onClick={run} className="rounded-xl bg-emerald-600 px-3 py-2 font-black text-white disabled:opacity-40">{t('playground.explorationAgent.runProposal')}</button>
      </div>
      <details className="mt-3 text-[10px] text-slate-500"><summary className="cursor-pointer font-bold">{t('playground.explorationAgent.advanced')}</summary><pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-950 p-2 text-slate-200">{JSON.stringify(scenario, null, 2)}</pre></details>
    </div>}
    {runResult && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
      <p className="font-black">{t('playground.explorationAgent.completed')}</p>
      <p className="mt-1">{t('playground.explorationAgent.actualChanged')}: {diffLabel(runResult.mutationDiff, t)}</p>
      <p className="mt-1">{t('playground.explorationAgent.actualHeld')}: {runResult.mutationDiff?.unchanged?.join(', ') || t('playground.explorationAgent.none')}</p>
      <p className="mt-1">{t('playground.explorationAgent.evidenceFocus')}: {runResult.evidenceFocus.join(', ')}</p>
      {runResult.followUps?.length > 0 && <div className="mt-2"><p className="font-black">{t('playground.explorationAgent.followUps')}</p><ul className="mt-1 space-y-1">{runResult.followUps.map((item) => <li key={item.id}>• {t(`playground.explorationAgent.followUp.${item.id}`)}</li>)}</ul></div>}
    </div>}
    {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">{error.code ?? 'EXPLORATION_FAILED'}: {error.message}</p>}
    {!snapshot?.model && <p className="mt-3 text-xs font-bold text-amber-800">{t('playground.explorationAgent.modelRequired')}</p>}
  </section>;
}
