import { useMemo } from 'react';
import { CONCEPTUAL_DEPTHS } from '../../core/ui/uiArchitecture.js';
import { deriveExploreDepthCapabilities } from '../../core/ui/exploreDepth.js';
import BigIdeaPrompt from './BigIdeaPrompt.jsx';
import GuidedExplore from './GuidedExplore.jsx';
import ExplorationThreadPanel from './ExplorationThreadPanel.jsx';
import ExplorationEvidence from './ExplorationEvidence.jsx';
import ExploreAgentSurface from './ExploreAgentSurface.jsx';
import PlaygroundAgentPanel from './PlaygroundAgentPanel.jsx';
import PlaygroundTimeline from './PlaygroundTimeline.jsx';
import TrainingMicroscopePanel from './TrainingMicroscopePanel.jsx';
import PlaygroundInspector from './PlaygroundInspector.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';
import { usePresentationCapabilities } from './usePresentationCapabilities.jsx';

export default function ExploreDetailsRegion({ snapshot, modelPlayground, bigIdea, agent, host, activeDepth, onDepthChange, agentOpen, onAgentOpen, onAgentClose, onDispatch, onGuidanceChange, formulaPrimitive, t }) {
  const { responsive } = usePresentationCapabilities();
  const capabilities = useMemo(() => deriveExploreDepthCapabilities(snapshot), [snapshot]);
  const compact = responsive.band === 'compact';
  const panelClass = compact
    ? 'fixed inset-x-0 bottom-0 z-[90] max-h-[78dvh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-4 shadow-2xl'
    : 'fixed right-4 top-24 z-[90] max-h-[78vh] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl';
  const mechanismTitle = t(capabilities.mechanismLabelKey);
  const depthEntries = [
    { id: CONCEPTUAL_DEPTHS.EVIDENCE, label: t('playground.depth.whatChanged'), available: capabilities[CONCEPTUAL_DEPTHS.EVIDENCE] },
    { id: CONCEPTUAL_DEPTHS.MECHANISM, label: mechanismTitle, available: capabilities[CONCEPTUAL_DEPTHS.MECHANISM] },
    { id: CONCEPTUAL_DEPTHS.REPRESENTATION, label: t('playground.depth.inspectModel'), available: capabilities[CONCEPTUAL_DEPTHS.REPRESENTATION] },
  ].filter((entry) => entry.available);

  const toggleDepth = (depth) => onDepthChange?.(activeDepth === depth ? null : depth);

  return <section data-ui-region="details-region" className="relative min-w-0 space-y-3" aria-label={t('playground.depth.regionLabel')}>
    <section data-ui-region="depth-entrances" aria-label={t('playground.depth.regionLabel')} className="rounded-2xl border border-slate-200 bg-white/80 p-3">
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
          onClick={() => toggleDepth(entry.id)}
          className={`rounded-xl border px-3 py-2 text-xs font-black transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${activeDepth === entry.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
        >{entry.label}</button>)}
      </div>
    </section>

    {agent && <>
      <button type="button" aria-expanded={Boolean(agentOpen)} aria-controls="explore-agent-guide" onClick={onAgentOpen} className="w-full rounded-2xl border border-violet-200 bg-violet-50/70 px-3 py-2 text-left text-sm font-black text-violet-900 hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500">
        {t('playground.agentGuide.entry')}
      </button>
      {agentOpen && <div id="explore-agent-guide"><ExploreAgentSurface snapshot={snapshot} agent={agent} capabilities={capabilities} compact={compact} onClose={onAgentClose} onDepthChange={onDepthChange} host={host} t={t} /></div>}
    </>}

    {activeDepth && <div id={`explore-depth-${activeDepth}`} role="dialog" aria-modal="false" aria-label={depthTitle(activeDepth, mechanismTitle, t)} className={panelClass}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-700">{t('playground.depth.openLabel')}</p>
          <h3 className="text-base font-black text-slate-950">{depthTitle(activeDepth, mechanismTitle, t)}</h3>
        </div>
        <button type="button" aria-label={t('playground.depth.close')} onClick={() => onDepthChange?.(null)} className="min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.depth.close')}</button>
      </div>
      {activeDepth === CONCEPTUAL_DEPTHS.EVIDENCE && <ExplorationEvidence snapshot={snapshot} t={t} openByDefault />}
      {activeDepth === CONCEPTUAL_DEPTHS.MECHANISM && <MechanismContent snapshot={snapshot} capabilities={capabilities} formulaPrimitive={formulaPrimitive} onDispatch={onDispatch} t={t} />}
      {activeDepth === CONCEPTUAL_DEPTHS.REPRESENTATION && <PlaygroundInspector playground={modelPlayground} snapshot={snapshot} onDispatch={onDispatch} t={t} />}
    </div>}

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
