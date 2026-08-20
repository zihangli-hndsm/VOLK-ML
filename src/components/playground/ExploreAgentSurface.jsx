import { useMemo, useState } from 'react';
import { CONCEPTUAL_DEPTHS } from '../../core/ui/uiArchitecture.js';
import { classifyAgentGuideRequest, deriveAgentComparisonExplanation, deriveAgentSemanticExplanation, routeAgentAiInterpretation, AGENT_GUIDANCE_OUTCOMES } from '../../core/ui/agentGuide.js';
import { deriveCleanerComparisonProposal } from '../../core/exploration/cleanerComparison.js';
import { createExplorationAiInterpreter } from '../../core/exploration/explorationAiInterpreter.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';
import ExplorationAgentPanel from './ExplorationAgentPanel.jsx';
import CompactBottomSheet from '../CompactBottomSheet.jsx';
import ConceptCard from './ConceptCard.jsx';

const pedagogicalGoalCopy = {
  'class-separation': {
    question: 'playground.pedagogical.goal.classSeparation.question',
    change: 'playground.pedagogical.goal.classSeparation.change',
    watch: 'playground.pedagogical.goal.classSeparation.watch',
  },
  'train-test-support-shift': {
    question: 'playground.pedagogical.goal.supportShift.question',
    change: 'playground.pedagogical.goal.supportShift.change',
    watch: 'playground.pedagogical.goal.supportShift.watch',
  },
  'observation-noise': {
    question: 'playground.pedagogical.goal.noise.question',
    change: 'playground.pedagogical.goal.noise.change',
    watch: 'playground.pedagogical.goal.noise.watch',
  },
  'outlier-sensitivity': {
    question: 'playground.pedagogical.goal.outliers.question',
    change: 'playground.pedagogical.goal.outliers.change',
    watch: 'playground.pedagogical.goal.outliers.watch',
  },
};

function semanticLabel(value, t) {
  const keys = {
    world: 'playground.explorationAgent.semantic.world',
    model: 'playground.explorationAgent.semantic.model',
    learning: 'playground.explorationAgent.semantic.learning',
    evaluation: 'playground.explorationAgent.semantic.evaluation',
    noise: 'playground.explorationAgent.semantic.noise',
    'model-configuration': 'playground.explorationAgent.semantic.model',
    'learning-configuration': 'playground.explorationAgent.semantic.learning',
    'evaluation-configuration': 'playground.explorationAgent.semantic.evaluation',
    'train-test': 'playground.explorationAgent.semantic.trainTest',
    'existing-train-test-setup': 'playground.explorationAgent.semantic.trainTest',
  };
  return keys[value] ? t(keys[value]) : value;
}

function compactProposal(proposal, t) {
  const scenario = proposal?.scenario;
  return scenario ? {
    summary: scenario.interpretation?.summary ?? '',
    change: (scenario.change ?? []).map((item) => item.semanticTarget ?? item.operation),
    hold: (scenario.hold ?? []).map((item) => semanticLabel(item, t)),
    fidelity: proposal.assessment?.fidelity?.status ?? null,
    pedagogical: scenario.pedagogicalDesign ? {
      goal: scenario.pedagogicalDesign.goal,
      copy: pedagogicalGoalCopy[scenario.pedagogicalDesign.goal] ?? null,
    } : null,
  } : null;
}

export default function ExploreAgentSurface({ snapshot, agent, capabilities, compact = false, onClose, onDepthChange, onOpenAiSettings, host, closeRef, t }) {
  const { config, gateway, isConfigured } = useAiProvider();
  const aiInterpreter = useMemo(() => createExplorationAiInterpreter({ gateway }), [gateway]);
  const [request, setRequest] = useState('');
  const [prediction, setPrediction] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [result, setResult] = useState(null);
  const [conceptCard, setConceptCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [aiFallback, setAiFallback] = useState(false);
  const [cleanerOptions, setCleanerOptions] = useState(null);
  const [cleanerUnavailable, setCleanerUnavailable] = useState(false);
  const comparison = deriveAgentComparisonExplanation(snapshot);
  const cleanerCandidate = deriveCleanerComparisonProposal({ snapshot, comparison: snapshot.experimentWorkspace?.comparison });
  const semanticExplanation = outcome?.kind === AGENT_GUIDANCE_OUTCOMES.EXPLANATION
    ? deriveAgentSemanticExplanation(outcome.topic, snapshot)
    : null;
  const presentation = {
    currentDepth: null,
    comparisonActive: Boolean(snapshot.experimentWorkspace?.comparison?.enabled),
    availableDepths: [CONCEPTUAL_DEPTHS.EVIDENCE, CONCEPTUAL_DEPTHS.MECHANISM, CONCEPTUAL_DEPTHS.REPRESENTATION]
      .filter((depth) => capabilities[depth]),
  };

  const loadProposal = async (nextOutcome, proposalRequest = request) => {
    setOutcome(nextOutcome);
    setProposal(null);
    setResult(null);
    setConceptCard(null);
    setError(null);
    setBusy(true);
    try {
      const nextProposal = await agent.proposeExploration({
        request: proposalRequest,
        ...(nextOutcome.intent ? { intent: nextOutcome.intent } : {}),
        ...(nextOutcome.design ? { design: nextOutcome.design } : {}),
        ...(nextOutcome.worldDesign ? { worldDesign: { ...nextOutcome.worldDesign, requestedHolds: nextOutcome.requestedHolds ?? [] } } : {}),
      });
      setProposal(nextProposal);
      if (nextProposal?.kind === 'clarification') setOutcome({ kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: nextProposal.interpretation?.messageKey ?? nextProposal.interpretation?.ambiguity ?? nextProposal.reason ?? 'world-composer-unavailable' });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!request.trim() || busy) return;
    setAiFallback(false);
    setCleanerOptions(null);
    setCleanerUnavailable(false);
    let nextOutcome = classifyAgentGuideRequest({ request, capabilities, snapshot });
    if (isConfigured && (nextOutcome.useAi || nextOutcome.kind === AGENT_GUIDANCE_OUTCOMES.CLARIFICATION)) {
      setBusy(true);
      try {
        const interpretation = await aiInterpreter.interpret({
          request,
          context: {
            ...agent.inspectContext({ presentation }),
            pedagogicalObservation: result?.pedagogicalObservation ?? null,
          },
          config,
        });
        nextOutcome = routeAgentAiInterpretation({ interpretation, request, snapshot, capabilities }) ?? nextOutcome;
      } catch {
        setAiFallback(true);
      } finally {
        setBusy(false);
      }
    }
    if (nextOutcome.kind === AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL || nextOutcome.kind === AGENT_GUIDANCE_OUTCOMES.WORLD_DESIGN_PROPOSAL) {
      await loadProposal(nextOutcome);
      return;
    }
    setOutcome(nextOutcome);
    setProposal(null);
    setResult(nextOutcome.kind === AGENT_GUIDANCE_OUTCOMES.EXPLANATION && result ? result : null);
    setError(null);
  };

  const openDepth = (depth) => {
    onClose?.();
    onDepthChange?.(depth);
  };

  const runProposal = async () => {
    if (proposal?.kind !== 'proposal' || busy) return;
    setBusy(true);
    setError(null);
    const threadActive = Boolean(snapshot.activeExplorationThread);
    try {
      if (prediction.trim() && threadActive) {
        // A prediction is a learner statement about the pending scenario. It
        // must be captured before the runtime can produce the result.
        agent.addExplorationThreadPrediction({ text: prediction.trim(), scenario: proposal.scenario, actor: 'human' });
      }
      const nextResult = await agent.executeExploration(proposal.scenario);
      if (threadActive) {
        try {
          agent.recordExplorationThreadExperiment({ scenario: proposal.scenario, actor: 'agent' });
          agent.recordExplorationThreadObservation({ scenario: proposal.scenario, actor: 'agent' });
        } catch {
          // Thread capture is historical presentation evidence and must not
          // turn an already committed experiment into a failed runtime action.
        }
      }
      setResult(nextResult);
      const shownConceptIds = new Set(snapshot?.conceptExposure?.shownConceptIds ?? []);
      const nextConcept = nextResult.conceptSignals?.concepts
        ?.find((signal) => !shownConceptIds.has(signal.id)) ?? null;
      const surfaced = nextConcept
        ? agent.recordInquiryPresentationEvent?.({ type: 'concept-card-surfaced', conceptId: nextConcept.id })
        : null;
      setConceptCard(surfaced ? nextConcept : null);
      setProposal(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const followUp = (item) => {
    if (!item?.design) return;
    loadProposal({ kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, design: item.design }, item.request ?? request);
  };

  const proposeCleanerComparison = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await agent.proposeCleanerComparison();
      if (result.kind === 'cleaner-proposals' && result.options.length) {
        setCleanerOptions(result.options);
        setCleanerUnavailable(false);
      } else {
        setCleanerOptions([]);
        setCleanerUnavailable(true);
      }
    } catch (caught) {
      setCleanerOptions([]);
      setCleanerUnavailable(true);
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const selectCleanerProposal = (nextProposal) => {
    setOutcome({ kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, intent: 'cleaner-comparison' });
    setProposal(nextProposal);
    setResult(null);
    setConceptCard(null);
    setError(null);
  };

  const panelClass = compact
    ? 'ui-motion-overlay-enter fixed inset-x-0 bottom-0 z-[95] max-h-[78dvh] overflow-y-auto rounded-t-3xl border border-violet-200 bg-white p-4 shadow-2xl'
    : 'ui-motion-overlay-enter fixed right-4 top-24 z-[95] max-h-[78vh] w-[min(380px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-violet-200 bg-white p-4 shadow-2xl';

  return <CompactBottomSheet compact={compact} open onClose={onClose} className={panelClass} role="dialog" aria-modal="false" aria-label={t('playground.agentGuide.ariaLabel')}>
    <div className="flex items-start justify-between gap-3 border-b border-violet-100 pb-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-violet-700">{t('playground.agentGuide.title')}</p>
        <p className="mt-1 text-sm font-bold text-slate-800">{t('playground.agentGuide.subtitle')}</p>
      </div>
      <button ref={closeRef} type="button" aria-label={t('playground.agentGuide.close')} onClick={onClose} className="ui-motion-interactive min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500">{t('playground.agentGuide.close')}</button>
    </div>
    <div className="mt-3 flex gap-2">
      <input value={request} onChange={(event) => setRequest(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') ask(); }} placeholder={t('playground.agentGuide.placeholder')} aria-label={t('playground.agentGuide.inputLabel')} className="min-w-0 flex-1 rounded-xl border border-violet-200 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" />
      <button type="button" disabled={!request.trim() || busy} onClick={ask} className="ui-motion-interactive rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-500">{busy ? t('playground.agentGuide.working') : t('playground.agentGuide.ask')}</button>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
      <span>{isConfigured ? t('ai.statusConfigured') : t('ai.statusLocalFallback')}</span>
      <button type="button" onClick={onOpenAiSettings} className="rounded-lg px-2 py-1 font-bold text-violet-700 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500">
        {isConfigured ? t('ai.settings') : t('ai.configure')}
      </button>
    </div>

    {outcome?.kind === AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH && <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
      <p>{t('playground.agentGuide.depthSuggestion')}</p>
      <button type="button" onClick={() => openDepth(outcome.depth)} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-800 ring-1 ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
        {outcome.depth === CONCEPTUAL_DEPTHS.EVIDENCE ? t('playground.depth.whatChanged') : outcome.depth === CONCEPTUAL_DEPTHS.MECHANISM ? t(capabilities.mechanismLabelKey) : t('playground.depth.inspectModel')}
      </button>
    </div>}

    {outcome?.kind === AGENT_GUIDANCE_OUTCOMES.EXPLANATION && <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-950">
      <p className="font-black">{t('playground.pedagogical.interpretationTitle')}</p>
      {outcome.topic === 'comparison' ? <>
        {comparison.kind === 'mixed-comparison' && <p className="mt-1">{t('playground.agentGuide.mixedComparison')}</p>}
        {comparison.kind !== 'mixed-comparison' && <p className="mt-1">{t('playground.agentGuide.comparisonFacts')}</p>}
        <p className="mt-2 text-xs">{t('playground.experiment.changed')}: {comparison.changed.map((item) => semanticLabel(item, t)).join(', ') || t('playground.explorationAgent.none')}</p>
        {comparison.kind === 'mixed-comparison' && cleanerCandidate.options.length > 0 && !cleanerOptions && <button type="button" disabled={busy} onClick={proposeCleanerComparison} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-800 ring-1 ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('playground.agentGuide.tryCleaner')}</button>}
        {cleanerOptions?.length > 0 && <div className="mt-2 flex flex-wrap gap-2"><span className="basis-full text-xs font-bold text-emerald-900">{t('playground.agentGuide.changeOnly')}</span>{cleanerOptions.map((option) => <button key={option.factor} type="button" onClick={() => selectCleanerProposal(option)} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-800 ring-1 ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t(`playground.agentGuide.changeOnly.${option.factor}`)}</button>)}</div>}
        {cleanerUnavailable && <p className="mt-2 text-xs">{t('playground.agentGuide.cleanerUnavailable')}</p>}
        <button type="button" onClick={() => openDepth(CONCEPTUAL_DEPTHS.EVIDENCE)} className="mt-2 ml-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-800 ring-1 ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('playground.agentGuide.showEvidence')}</button>
      </> : <p className="mt-1">{outcome.explanation || (semanticExplanation?.available ? t(`playground.agentGuide.explain.${outcome.topic}`) : t('playground.agentGuide.clarification'))}</p>}
    </div>}

    {(outcome?.kind === AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL || outcome?.kind === AGENT_GUIDANCE_OUTCOMES.WORLD_DESIGN_PROPOSAL) && proposal?.kind === 'proposal' && <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 p-3 text-xs text-slate-800">
      <p className="font-black text-violet-800">{compactProposal(proposal, t).pedagogical ? t('playground.pedagogical.proposalTitle') : t('playground.agentGuide.proposalTitle')}</p>
      {compactProposal(proposal, t).pedagogical ? <>
        <p className="mt-1 font-bold">{t(compactProposal(proposal, t).pedagogical.copy.question)}</p>
        <p className="mt-2"><span className="font-black">{t('playground.explorationAgent.change')}:</span> {t(compactProposal(proposal, t).pedagogical.copy.change)}</p>
        <p className="mt-1"><span className="font-black">{t('playground.explorationAgent.hold')}:</span> {compactProposal(proposal, t).hold.join(', ') || t('playground.explorationAgent.none')}</p>
        <p className="mt-1"><span className="font-black">{t('playground.explorationAgent.observe')}:</span> {t(compactProposal(proposal, t).pedagogical.copy.watch)}</p>
        <label className="mt-3 block"><span className="font-black">{t('playground.pedagogical.predictionLabel')}</span><input value={prediction} onChange={(event) => setPrediction(event.target.value)} placeholder={t('playground.pedagogical.predictionPlaceholder')} className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-2 py-2 outline-none focus:ring-2 focus:ring-violet-500" /></label>
      </> : <>
        <p className="mt-1">{compactProposal(proposal, t).summary}</p>
        <p className="mt-2"><span className="font-black">{t('playground.explorationAgent.change')}:</span> {compactProposal(proposal, t).change.map((item) => semanticLabel(item, t)).join(', ')}</p>
        <p className="mt-1"><span className="font-black">{t('playground.explorationAgent.hold')}:</span> {compactProposal(proposal, t).hold.join(', ') || t('playground.explorationAgent.none')}</p>
      </>}
      <p className="mt-1 text-slate-500">{t('playground.agentGuide.proposalReady')}</p>
      <button type="button" disabled={busy} onClick={runProposal} className="mt-3 rounded-xl bg-emerald-600 px-3 py-2 font-black text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-500">{compactProposal(proposal, t).pedagogical ? t('playground.pedagogical.runExperiment') : t('playground.agentGuide.tryIt')}</button>
    </div>}

    {outcome?.kind === AGENT_GUIDANCE_OUTCOMES.CLARIFICATION && <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-950">{outcome.reason?.startsWith?.('playground.') ? t(outcome.reason) : outcome.reason === 'world-control' ? t('playground.agentGuide.worldTools') : t('playground.agentGuide.clarification')}</p>}
    {aiFallback && <p className="mt-2 text-xs font-bold text-slate-500">{t('playground.agentGuide.aiFallback')}</p>}
    {result && <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-950">
      <p className="font-black">{t('playground.agentGuide.completed')}</p>
      {result.pedagogicalObservation?.available ? <>
        <p className="mt-2 text-xs font-black uppercase tracking-wide text-emerald-800">{t('playground.pedagogical.observationTitle')}</p>
        <p className="mt-1">{t(result.pedagogicalObservation.summaryKey)}</p>
        <p className="mt-2 text-xs font-black uppercase tracking-wide text-emerald-800">{t('playground.pedagogical.evidenceTitle')}</p>
        {result.pedagogicalObservation.facts.map((fact) => <p key={fact.id} className="mt-1 text-xs">{t(fact.labelKey)}{fact.before !== undefined && fact.after !== undefined ? `: ${fact.before} → ${fact.after}` : `: ${t('playground.pedagogical.heldFixed')}`}</p>)}
      </> : result.pedagogicalEvidence && <p className="mt-2 text-xs">{t('playground.pedagogical.evidenceUnavailable')}</p>}
      <ConceptCard signal={conceptCard} observation={result.pedagogicalObservation} nextQuestion={result.nextQuestions?.[0]} onNextQuestion={() => followUp(result.nextQuestions[0])} t={t} />
      {result.nextQuestions?.length > 0 && <div className="mt-3"><p className="text-xs font-black">{t('playground.pedagogical.nextQuestions')}</p><div className="mt-1 flex flex-col gap-2">{result.nextQuestions.map((item, index) => <button key={`${item.goal}-${index}`} type="button" onClick={() => followUp(item)} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-black text-emerald-800 ring-1 ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"><span className="block">{t(item.questionKey)}</span><span className="mt-1 block text-[10px] font-normal text-emerald-700">{t(item.rationaleKey)}</span></button>)}</div></div>}
      <button type="button" onClick={() => openDepth(CONCEPTUAL_DEPTHS.EVIDENCE)} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-800 ring-1 ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('playground.agentGuide.showEvidence')}</button>
    </div>}
    {error && <div role="alert" className="ui-motion-error mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-800"><p className="font-bold">{t('playground.agentGuide.errorGeneric')}</p><details className="mt-1"><summary className="cursor-pointer font-mono text-[10px]">{error.code ?? 'EXPLORATION_FAILED'}</summary><p className="mt-1 font-mono text-[10px]">{error.message}</p></details></div>}

    <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-xs font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500">{t('playground.agentGuide.advanced')}</summary>
      <div className="mt-3"><ExplorationAgentPanel agent={agent} snapshot={snapshot} presentation={presentation} t={t} /></div>
    </details>
  </CompactBottomSheet>;
}
