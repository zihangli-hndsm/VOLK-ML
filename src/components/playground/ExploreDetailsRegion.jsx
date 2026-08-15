import BigIdeaPrompt from './BigIdeaPrompt.jsx';
import GuidedExplore from './GuidedExplore.jsx';
import ExplorationThreadPanel from './ExplorationThreadPanel.jsx';
import ExplorationEvidence from './ExplorationEvidence.jsx';
import ExplorationAgentPanel from './ExplorationAgentPanel.jsx';
import PlaygroundAgentPanel from './PlaygroundAgentPanel.jsx';
import PlaygroundTimeline from './PlaygroundTimeline.jsx';
import TrainingMicroscopePanel from './TrainingMicroscopePanel.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';

export default function ExploreDetailsRegion({ snapshot, bigIdea, agent, host, onDispatch, onGuidanceChange, formulaPrimitive, t }) {
  return <details data-ui-region="details-region" className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
    <summary className="cursor-pointer list-none rounded-xl px-2 py-2 text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.explore.secondary')}</summary>
    <div className="mt-4 space-y-4">
      <p className="text-xs text-slate-500">{t('playground.explore.secondaryHint')}</p>
      <BigIdeaPrompt entry={bigIdea} snapshot={snapshot} agent={agent} host={host} onRestart={() => host.restartBigIdeaEntrance({ id: snapshot.bigIdea.id })} t={t} />
      <GuidedExplore snapshot={snapshot} onDispatch={onDispatch} onGuidanceChange={onGuidanceChange} t={t} />
      {agent && <ExplorationThreadPanel agent={agent} snapshot={snapshot} t={t} />}
      <ExplorationEvidence snapshot={snapshot} t={t} />
      {agent && snapshot.model && <ExplorationAgentPanel agent={agent} snapshot={snapshot} t={t} />}
      {agent && snapshot.model && <details className="rounded-2xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.explorationAgent.advancedTeaching')}</summary><div className="mt-3"><PlaygroundAgentPanel host={host} agent={agent} snapshot={snapshot} t={t} /></div></details>}
      {snapshot.model && <PlaygroundTimeline snapshot={snapshot} onDispatch={onDispatch} t={t} />}
      {snapshot.model && <TrainingMicroscopePanel snapshot={snapshot} onDispatch={onDispatch} t={t} />}
      {snapshot.model && <div className="rounded-2xl bg-slate-950 p-4 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.formulaTitle')}</p><div className="mt-2">{formulaPrimitive ? <FormulaRenderer props={formulaPrimitive.props} t={t} /> : <p className="font-mono text-sm font-bold text-sky-300">—</p>}</div></div>}
    </div>
  </details>;
}
