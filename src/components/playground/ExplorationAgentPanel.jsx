import { useMemo, useState } from 'react';
import { createExplorationAiInterpreter } from '../../core/exploration/explorationAiInterpreter.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';

function changeLabel(change, t) {
  const keys = {
    outliers: 'playground.explorationAgent.changeOutliers',
    'test-input-support': 'playground.explorationAgent.changeTestSupport',
    noise: 'playground.explorationAgent.changeNoise',
    'observation-values': 'playground.explorationAgent.changeValues',
    'existing-train-test-setup': 'playground.explorationAgent.semantic.trainTest',
    'input-distribution': 'playground.explorationAgent.semantic.inputDistribution',
  };
  return keys[change.semanticTarget] ? t(keys[change.semanticTarget]) : change.semanticTarget ?? change.operation;
}

function diffLabel(diff, t) {
  return diff?.changed?.length ? diff.changed.map((item) => semanticLabel(item, t)).join(', ') : t('playground.explorationAgent.none');
}

function semanticLabel(value, t) {
  const keys = {
    world: 'playground.explorationAgent.semantic.world',
    trainTest: 'playground.explorationAgent.semantic.trainTest',
    model: 'playground.explorationAgent.semantic.model',
    learning: 'playground.explorationAgent.semantic.learning',
    evaluation: 'playground.explorationAgent.semantic.evaluation',
    randomness: 'playground.explorationAgent.semantic.randomness',
    'model-configuration': 'playground.explorationAgent.semantic.model',
    'learning-configuration': 'playground.explorationAgent.semantic.learning',
    'evaluation-configuration': 'playground.explorationAgent.semantic.evaluation',
    'latent-relation': 'playground.explorationAgent.semantic.relation',
    noise: 'playground.explorationAgent.semantic.noise',
    'existing-train-test-setup': 'playground.explorationAgent.semantic.trainTest',
    'train-distribution': 'playground.explorationAgent.semantic.trainDistribution',
    'train-sample-count': 'playground.explorationAgent.semantic.trainSamples',
    'test-sample-count': 'playground.explorationAgent.semantic.testSamples',
    'world.trainXRange': 'playground.evidence.trainXRange',
    'world.testXRange': 'playground.evidence.testXRange',
    'model.slope': 'playground.evidence.slope',
    'model.bias': 'playground.evidence.bias',
    'outcome.trainMse': 'playground.evidence.trainMse',
    'outcome.testMse': 'playground.evidence.testMse',
    slopeDifference: 'playground.evidence.slopeDifference',
    coverageMismatch: 'playground.evidence.coverageMismatch',
    generalizationGap: 'playground.evidence.generalizationGap',
  };
  return keys[value] ? t(keys[value]) : value;
}

function fidelityLabel(status, t) {
  const key = `playground.explorationAgent.fidelity.${status}`;
  return t(key);
}

export default function ExplorationAgentPanel({ agent, snapshot, presentation = null, t }) {
  const { config, gateway, isConfigured } = useAiProvider();
  const interpreter = useMemo(() => createExplorationAiInterpreter({ gateway }), [gateway]);
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [prediction, setPrediction] = useState('');
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [aiMode, setAiMode] = useState('ai');
  const [aiNotice, setAiNotice] = useState(null);

  const ask = async (intent) => {
    if (!request.trim() || busy) return;
    setBusy(true);
    setError(null);
    setRunResult(null);
    setRecorded(false);
    try {
      let next;
      setAiNotice(null);
      if (!intent && aiMode === 'ai' && isConfigured) {
        try {
          const interpreted = await interpreter.interpret({ request, context: agent.inspectContext({ presentation }), config });
          next = await agent.proposeExploration({ request, intent: interpreted.intent });
        } catch (aiError) {
          setAiNotice(t('playground.explorationAgent.aiFallback'));
          next = await agent.proposeExploration({ request });
        }
      } else {
        next = await agent.proposeExploration(intent ? { request, intent } : { request });
      }
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
      if (prediction.trim() && snapshot.activeExplorationThread) {
        await agent.addExplorationThreadPrediction({ text: prediction.trim(), scenario: proposal.scenario, actor: 'human' });
        setPrediction('');
      }
      const result = await agent.executeExploration(proposal.scenario);
      setRunResult(result);
      setProposal(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const recordResult = async () => {
    if (!runResult || !snapshot.activeExplorationThread || busy) return;
    setBusy(true);
    setError(null);
    try {
      await agent.recordExplorationThreadExperiment({ scenario: runResult.scenario, actor: 'agent' });
      await agent.recordExplorationThreadObservation({ scenario: runResult.scenario, actor: 'agent' });
      setRecorded(true);
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };

  const chooseFollowUp = async (item) => {
    const promptKeys = {
      'repeat-condition': 'playground.explorationAgent.followUpPrompt.repeatCondition',
      'smaller-change': 'playground.explorationAgent.followUpPrompt.smallerChange',
    };
    const prompt = promptKeys[item.id] ? t(promptKeys[item.id]) : null;
    if (!prompt) return;
    if (snapshot.activeExplorationThread) {
      try { await agent.addExplorationThreadQuestion({ text: prompt, actor: 'human', source: 'agent-follow-up' }); }
      catch (caught) { setError(caught); return; }
    }
    setRequest(prompt);
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
      <p className="font-black">{proposal.interpretation.message ?? t('playground.explorationAgent.clarify')}</p>
      <div className="mt-2 flex flex-wrap gap-2">{(proposal.interpretation.choices ?? []).map((choice) => <button type="button" key={choice.id} onClick={() => ask(choice.id)} className="rounded-lg bg-white px-2 py-1 font-bold text-amber-900 ring-1 ring-amber-200">{choice.label}</button>)}</div>
    </div>}
    {scenario && <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3 text-xs">
      <p className="font-black text-violet-800">{t('playground.explorationAgent.proposalTitle')}</p>
      <p className="mt-1 text-slate-600">{scenario.interpretation.summary}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div><p className="font-black uppercase tracking-wider text-rose-600">{t('playground.explorationAgent.change')}</p><ul className="mt-1 space-y-1 text-slate-700">{scenario.change.map((change, index) => <li key={`${change.operation}-${index}`}>• {changeLabel(change, t)}</li>)}</ul></div>
        <div><p className="font-black uppercase tracking-wider text-emerald-600">{t('playground.explorationAgent.hold')}</p><p className="mt-1 text-slate-700">{scenario.hold.map((item) => semanticLabel(item, t)).join(', ')}</p></div>
        <div><p className="font-black uppercase tracking-wider text-blue-600">{t('playground.explorationAgent.observe')}</p><p className="mt-1 text-slate-700">{scenario.observe.map((item) => semanticLabel(item, t)).join(', ')}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-2 py-1 font-black text-emerald-800">{t('playground.explorationAgent.fidelity')}: {fidelityLabel(proposal.assessment?.fidelity?.status, t)}</span>
        {proposal.assessment?.fidelity?.missing?.length > 0 && <span className="text-amber-800">{proposal.assessment.fidelity.missing.map((item) => semanticLabel(item, t)).join(', ')}</span>}
        {proposal.assessment?.fidelity?.approximations?.map((item) => <span key={item} className="text-amber-800">{item}</span>)}
        <button type="button" disabled={busy} onClick={run} className="rounded-xl bg-emerald-600 px-3 py-2 font-black text-white disabled:opacity-40">{t('playground.explorationAgent.runProposal')}</button>
      </div>
      {snapshot.activeExplorationThread && <label className="mt-3 block text-xs font-bold text-slate-700">{t('playground.thread.predictionPlaceholder')}<input value={prediction} onChange={(event) => setPrediction(event.target.value)} className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" /></label>}
      <details className="mt-3 text-[10px] text-slate-500"><summary className="cursor-pointer font-bold">{t('playground.explorationAgent.advanced')}</summary><pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-950 p-2 text-slate-200">{JSON.stringify(scenario, null, 2)}</pre></details>
    </div>}
    {runResult && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
      <p className="font-black">{t('playground.explorationAgent.completed')}</p>
      <p className="mt-1">{t('playground.explorationAgent.actualChanged')}: {diffLabel(runResult.mutationDiff, t)}</p>
      <p className="mt-1">{t('playground.explorationAgent.actualHeld')}: {runResult.mutationDiff?.unchanged?.map((item) => semanticLabel(item, t)).join(', ') || t('playground.explorationAgent.none')}</p>
      <p className="mt-1">{t('playground.explorationAgent.evidenceFocus')}: {runResult.evidenceFocus.map((item) => semanticLabel(item, t)).join(', ')}</p>
      <p className="mt-1">{t('playground.explorationAgent.proposalFidelity')}: {fidelityLabel(runResult.proposalFidelity?.status, t)}</p>
      <p className="mt-1">{t('playground.explorationAgent.executionFidelity')}: {fidelityLabel(runResult.executionFidelity?.status, t)}</p>
      {runResult.fidelityMismatch && <p role="alert" className="mt-2 rounded-lg bg-red-100 p-2 font-black text-red-800">{t('playground.explorationAgent.fidelityMismatch')}</p>}
      {runResult.followUps?.length > 0 && <div className="mt-2"><p className="font-black">{t('playground.explorationAgent.followUps')}</p><div className="mt-1 flex flex-wrap gap-2">{runResult.followUps.map((item) => <button type="button" key={item.id} onClick={() => chooseFollowUp(item)} className="rounded-lg bg-white px-2 py-1 text-left font-bold text-emerald-900 ring-1 ring-emerald-200">{t(`playground.explorationAgent.followUp.${item.id}`)}</button>)}</div></div>}
      {snapshot.activeExplorationThread && <button type="button" disabled={busy || recorded} onClick={recordResult} className="mt-3 rounded-xl bg-cyan-700 px-3 py-2 font-black text-white disabled:opacity-40">{recorded ? t('playground.thread.recorded') : t('playground.thread.addResult')}</button>}
    </div>}
    {aiNotice && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">{aiNotice}</p>}
    <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500"><span>{t('playground.explorationAgent.interpreter')}</span><button type="button" onClick={() => setAiMode('local')} className={aiMode === 'local' ? 'font-black text-violet-700' : ''}>{t('playground.explorationAgent.local')}</button><button type="button" disabled={!isConfigured} onClick={() => setAiMode('ai')} className={aiMode === 'ai' ? 'font-black text-violet-700' : 'disabled:opacity-40'}>{t('playground.explorationAgent.ai')}</button></div>
    {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">{error.code ?? 'EXPLORATION_FAILED'}: {error.message}</p>}
    {!snapshot?.model && <p className="mt-3 text-xs font-bold text-amber-800">{t('playground.explorationAgent.modelRequired')}</p>}
  </section>;
}
