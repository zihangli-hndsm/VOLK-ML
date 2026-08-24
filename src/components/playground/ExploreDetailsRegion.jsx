import { useEffect, useMemo, useRef } from 'react';
import { CONCEPTUAL_DEPTHS } from '../../core/ui/uiArchitecture.js';
import { deriveLumiMode } from '../../core/ui/lumiSemantics.js';
import { deriveLumiInteraction } from '../../core/ui/lumiInteraction.js';
import { deriveLumiJourneyProjection } from '../../core/ui/lumiJourney.js';
import { deriveExploreDepthCapabilities } from '../../core/ui/exploreDepth.js';
import { PRESENTATION_FOCUS_OWNERS, resolvePresentationFocusOwner } from '../../core/ui/presentationFocus.js';
import BigIdeaPrompt from './BigIdeaPrompt.jsx';
import GuidedExplore from './GuidedExplore.jsx';
import ExplorationThreadPanel from './ExplorationThreadPanel.jsx';
import ExplorationEvidence from './ExplorationEvidence.jsx';
import ExploreAgentSurface from './ExploreAgentSurface.jsx';
import PlaygroundAgentPanel from './PlaygroundAgentPanel.jsx';
import PlaygroundTimeline from './PlaygroundTimeline.jsx';
import TrainingMicroscopePanel from './TrainingMicroscopePanel.jsx';
import PlaygroundInspector from './PlaygroundInspector.jsx';
import TunePanel from './TunePanel.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';
import { usePresentationCapabilities } from './usePresentationCapabilities.jsx';
import { useAiProvider } from '../ai/AiProviderContext.jsx';
import CompactBottomSheet from '../CompactBottomSheet.jsx';
import Lumi from './Lumi.jsx';
import LumiAttentionRail from './LumiAttentionRail.jsx';
import LumiJourneyTimeline from './LumiJourneyTimeline.jsx';

export default function ExploreDetailsRegion({ snapshot, modelPlayground, bigIdea, agent, host, activeDepth, onDepthChange, agentOpen, onAgentOpen, onAgentClose, onDispatch, onGuidanceChange, formulaPrimitive, onOpenWorldTools, initialSelection, onAskAboutSelection, illuminatedConceptIds = [], journeyIlluminationEvents = [], onIlluminateConcept, t, intervention = null }) {
  const { responsive } = usePresentationCapabilities();
  const { isConfigured, openSettings } = useAiProvider();
  const capabilities = useMemo(() => deriveExploreDepthCapabilities(snapshot), [snapshot]);
  const attention = useMemo(() => deriveLumiInteraction({ snapshot, intervention, activeConceptId: bigIdea?.id }), [snapshot, intervention, bigIdea?.id]);
  const journey = useMemo(() => deriveLumiJourneyProjection({
    semanticEvents: snapshot?.semanticEvents,
    observations: snapshot?.observations,
    inquiry: snapshot?.learnerInquiry,
    activeConceptId: bigIdea?.id,
    illuminatedConceptIds,
    illuminationEvents: journeyIlluminationEvents,
  }), [snapshot?.semanticEvents, snapshot?.observations, snapshot?.learnerInquiry, bigIdea?.id, illuminatedConceptIds, journeyIlluminationEvents]);
  const compact = responsive.band === 'compact';
  const panelCloseRef = useRef(null);
  const triggerRefs = useRef({});
  const agentTriggerRef = useRef(null);
  const agentCloseRef = useRef(null);
  const previousDepthRef = useRef(activeDepth);
  const previousAgentOpenRef = useRef(agentOpen);
  const panelClass = compact
    ? 'fixed inset-x-0 bottom-0 z-[90] max-h-[78dvh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-4 shadow-2xl'
    : 'fixed right-4 top-24 z-[90] max-h-[78vh] w-[min(300px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl';
  const mechanismTitle = t(capabilities.mechanismLabelKey);
  const depthEntries = [
    { id: CONCEPTUAL_DEPTHS.TUNE, label: t('playground.layer.tune'), available: capabilities[CONCEPTUAL_DEPTHS.TUNE] },
    { id: CONCEPTUAL_DEPTHS.EVIDENCE, label: t('playground.depth.whatChanged'), available: capabilities[CONCEPTUAL_DEPTHS.EVIDENCE] },
    { id: CONCEPTUAL_DEPTHS.MECHANISM, label: mechanismTitle, available: capabilities[CONCEPTUAL_DEPTHS.MECHANISM] },
    { id: CONCEPTUAL_DEPTHS.REPRESENTATION, label: t('playground.depth.inspectModel'), available: capabilities[CONCEPTUAL_DEPTHS.REPRESENTATION] },
  ].filter((entry) => entry.available);

  useEffect(() => {
    const focusOwner = resolvePresentationFocusOwner({
      activeDepth,
      agentOpen,
      previousDepth: previousDepthRef.current,
      previousAgentOpen: previousAgentOpenRef.current,
    });
    if (focusOwner === PRESENTATION_FOCUS_OWNERS.AGENT) agentCloseRef.current?.focus();
    if (focusOwner === PRESENTATION_FOCUS_OWNERS.DEPTH) panelCloseRef.current?.focus();
    if (focusOwner === PRESENTATION_FOCUS_OWNERS.AGENT_TRIGGER) agentTriggerRef.current?.focus();
    if (focusOwner === PRESENTATION_FOCUS_OWNERS.DEPTH_TRIGGER) {
      triggerRefs.current[previousDepthRef.current]?.focus();
    }
    previousDepthRef.current = activeDepth;
    previousAgentOpenRef.current = agentOpen;
  }, [activeDepth, agentOpen]);

  const toggleDepth = (depth) => onDepthChange?.(activeDepth === depth ? null : depth);

  return <section data-ui-region="details-region" data-ui-layer={activeDepth === CONCEPTUAL_DEPTHS.TUNE ? 'tune' : activeDepth ? 'inspect' : 'play'} className="relative min-w-0 space-y-3" aria-label={t('playground.depth.regionLabel')}>
    <section data-ui-region="depth-entrances" data-ui-layer="play" aria-label={t('playground.depth.regionLabel')} className="rounded-2xl border border-slate-200 bg-white/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-800">{t('playground.depth.prompt')}</h3>
        <span className="text-xs text-slate-500">{t('playground.depth.optional')}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('playground.depth.regionLabel')}>
        {depthEntries.map((entry) => <button
          key={entry.id}
          type="button"
          aria-expanded={activeDepth === entry.id}
          aria-pressed={activeDepth === entry.id}
          aria-controls={`explore-depth-${entry.id}`}
          ref={(node) => { triggerRefs.current[entry.id] = node; }}
          onClick={() => toggleDepth(entry.id)}
          className={`ui-motion-interactive rounded-xl border px-3 py-2 text-xs font-black focus:outline-none focus:ring-2 focus:ring-blue-500 ${activeDepth === entry.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
        >{entry.label}</button>)}
      </div>
    </section>

    <LumiAttentionRail snapshot={snapshot} attention={attention} activeDepth={activeDepth} illuminatedConceptIds={illuminatedConceptIds} onOpenEvidence={() => onDepthChange?.(CONCEPTUAL_DEPTHS.EVIDENCE)} t={t} />
    <LumiJourneyTimeline journey={journey} snapshot={snapshot} compact={compact} t={t} />

    {agent && <>
      <div className="flex min-w-0 items-center gap-2">
        <Lumi presence="ambient" mode={deriveLumiMode({ hasObservation: Boolean(snapshot.observations?.length), hasGuidance: Boolean(snapshot.learnerInquiry?.candidates?.length) })} onClick={onAgentOpen} label={t('playground.lumi.openGuidance')} />
        <button ref={agentTriggerRef} type="button" aria-expanded={Boolean(agentOpen)} aria-controls="explore-agent-guide" onClick={onAgentOpen} className="ui-motion-interactive min-w-0 flex-1 rounded-2xl border border-violet-200 bg-violet-50/70 px-3 py-2 text-left text-sm font-black text-violet-900 hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500">
          {t('playground.agentGuide.entry')}
        </button>
        <button type="button" onClick={openSettings} className="shrink-0 rounded-xl px-2 py-2 text-[11px] font-bold text-violet-700 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500">
          {isConfigured ? t('ai.settings') : t('ai.configure')}
        </button>
      </div>
      {agentOpen && <div id="explore-agent-guide"><ExploreAgentSurface snapshot={snapshot} agent={agent} capabilities={capabilities} compact={compact} onClose={onAgentClose} onDepthChange={onDepthChange} onOpenAiSettings={openSettings} host={host} closeRef={agentCloseRef} initialSelection={initialSelection} onAskAboutSelection={onAskAboutSelection} illuminatedConceptIds={illuminatedConceptIds} onIlluminateConcept={onIlluminateConcept} t={t} /></div>}
    </>}

    {activeDepth && <CompactBottomSheet compact={compact} open onClose={() => onDepthChange?.(null)} id={`explore-depth-${activeDepth}`} data-ui-motion="depth-panel" role="dialog" aria-modal="false" aria-labelledby={`explore-depth-title-${activeDepth}`} className={`ui-motion-overlay-enter ${panelClass}`}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-700">{t('playground.depth.openLabel')}</p>
          <h3 id={`explore-depth-title-${activeDepth}`} className="text-base font-black text-slate-950">{depthTitle(activeDepth, mechanismTitle, t)}</h3>
        </div>
        <button ref={panelCloseRef} type="button" aria-label={t('playground.depth.close')} onClick={() => onDepthChange?.(null)} className="ui-motion-interactive min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.depth.close')}</button>
      </div>
      {activeDepth === CONCEPTUAL_DEPTHS.TUNE && <TunePanel playground={modelPlayground} snapshot={snapshot} onDispatch={onDispatch} onOpenWorldTools={onOpenWorldTools} t={t} />}
      {activeDepth === CONCEPTUAL_DEPTHS.EVIDENCE && <ExplorationEvidence snapshot={snapshot} t={t} openByDefault agent={agent} onAskAbout={onAskAboutSelection} attention={attention} />}
      {activeDepth === CONCEPTUAL_DEPTHS.MECHANISM && <MechanismContent snapshot={snapshot} capabilities={capabilities} formulaPrimitive={formulaPrimitive} onDispatch={onDispatch} t={t} />}
      {activeDepth === CONCEPTUAL_DEPTHS.REPRESENTATION && <PlaygroundInspector playground={modelPlayground} snapshot={snapshot} onDispatch={onDispatch} t={t} />}
    </CompactBottomSheet>}

    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer list-none rounded-xl px-2 py-2 text-sm font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.explore.more')}</summary>
      <div className="mt-3 space-y-2">
        {bigIdea && <details className="rounded-2xl border border-blue-100 bg-white p-3">
          <summary className="cursor-pointer text-xs font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.depth.aboutQuestion')}</summary>
          <div className="mt-3"><BigIdeaPrompt entry={bigIdea} snapshot={snapshot} agent={agent} host={host} onRestart={() => host.restartBigIdeaEntrance({ id: snapshot.bigIdea.id })} t={t} /></div>
        </details>}
        <details className="rounded-2xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.depth.guideMe')}</summary>
          <div className="mt-3"><GuidedExplore snapshot={snapshot} onDispatch={onDispatch} onGuidanceChange={onGuidanceChange} t={t} /></div>
        </details>
        {agent && <details className="rounded-2xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.depth.otherTools')}</summary>
          <div className="mt-3 space-y-3">
            <ExplorationThreadPanel agent={agent} snapshot={snapshot} t={t} />
            {snapshot.model && <details className="rounded-2xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-xs font-black text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.explorationAgent.advancedTeaching')}</summary><div className="mt-3"><PlaygroundAgentPanel host={host} agent={agent} snapshot={snapshot} t={t} /></div></details>}
          </div>
        </details>}
      </div>
    </details>
  </section>;
}

function depthTitle(depth, mechanismTitle, t) {
  if (depth === CONCEPTUAL_DEPTHS.TUNE) return t('playground.layer.tune');
  if (depth === CONCEPTUAL_DEPTHS.EVIDENCE) return t('playground.depth.whatChanged');
  if (depth === CONCEPTUAL_DEPTHS.MECHANISM) return mechanismTitle;
  return t('playground.depth.inspectModel');
}

function MechanismContent({ snapshot, capabilities, formulaPrimitive, onDispatch, t }) {
  return <div className="space-y-3">
    <p className="text-sm text-slate-600">{t(capabilities.hasTrainingMechanism ? 'playground.depth.mechanismDescription' : 'playground.depth.decisionDescription')}</p>
    {snapshot.timeline?.totalSteps > 0 && <PlaygroundTimeline snapshot={snapshot} onDispatch={onDispatch} t={t} />}
    {capabilities.hasTrainingMechanism && snapshot.trainingMicroscope && <TrainingMicroscopePanel snapshot={snapshot} onDispatch={onDispatch} t={t} openByDefault />}
    {formulaPrimitive && <section className="rounded-2xl bg-slate-950 p-4 text-center" aria-label={t('playground.formulaTitle')}><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.formulaTitle')}</p><div className="mt-2"><FormulaRenderer props={formulaPrimitive.props} t={t} /></div></section>}
  </div>;
}
