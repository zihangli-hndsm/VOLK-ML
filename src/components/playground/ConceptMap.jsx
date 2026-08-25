import { useEffect, useRef, useState } from 'react';
import { getInquiryConcept } from '../../core/exploration/learnerInquiry.js';
import { conceptGraphRelationSemantics, CONCEPT_GRAPH_RELATIONS, CONCEPT_GRAPH_STATES } from '../../core/ui/conceptGraph.js';
import { HYPOTHESIS_STATUSES } from '../../core/exploration/hypothesis.js';
import Lumi from './Lumi.jsx';

const nodeStateClass = {
  [CONCEPT_GRAPH_STATES.UNEXPLORED]: 'concept-map-node-unexplored',
  [CONCEPT_GRAPH_STATES.ACTIVE]: 'concept-map-node-active',
  [CONCEPT_GRAPH_STATES.ILLUMINATED]: 'concept-map-node-illuminated',
};

const relationKey = {
  [CONCEPT_GRAPH_RELATIONS.PREREQUISITE]: 'playground.conceptMap.relation.prerequisite',
  [CONCEPT_GRAPH_RELATIONS.RELATED]: 'playground.conceptMap.relation.related',
  [CONCEPT_GRAPH_RELATIONS.CAUSED_BY]: 'playground.conceptMap.relation.causedBy',
  [CONCEPT_GRAPH_RELATIONS.OBSERVED_WITH]: 'playground.conceptMap.relation.observedWith',
};

function conceptTitle(id, t) {
  const concept = getInquiryConcept(id);
  return concept?.titleKey ? t(concept.titleKey) : t('playground.lumi.target.concept');
}

function stateLabel(state, t) {
  return t(`playground.conceptMap.state.${state}`);
}

function evidenceLabel(id, snapshot, t) {
  const observation = (snapshot?.observations ?? []).find((item) => String(item?.id ?? '') === String(id) || String(item?.reasonCode ?? '') === String(id));
  return observation?.messageKey ? t(observation.messageKey) : id;
}

function nodeMode(node, graph) {
  if (node?.id === graph?.currentConceptId && graph?.experimentRelation) return 'intervene';
  if (node?.state === CONCEPT_GRAPH_STATES.ILLUMINATED) return 'illuminate';
  if (node?.state === CONCEPT_GRAPH_STATES.ACTIVE) return 'observe';
  return 'explore';
}

function hypothesisStatusClass(status) {
  if (status === HYPOTHESIS_STATUSES.TESTING) return 'hypothesis-map-node-testing';
  if (status === HYPOTHESIS_STATUSES.SUPPORTED) return 'hypothesis-map-node-supported';
  if (status === HYPOTHESIS_STATUSES.REJECTED) return 'hypothesis-map-node-rejected';
  return 'hypothesis-map-node-proposed';
}

function ConceptNode({ id, graph, t, onSelectConcept, role = 'listitem' }) {
  const node = graph?.nodes?.find((item) => item.id === id) ?? { id, state: CONCEPT_GRAPH_STATES.UNEXPLORED };
  const selected = graph?.selectedConceptId === id;
  const current = graph?.currentConceptId === id;
  return <div role={role} className={`concept-map-node ${nodeStateClass[node.state] ?? nodeStateClass[CONCEPT_GRAPH_STATES.UNEXPLORED]} ${selected ? 'concept-map-node-selected' : ''} ${current ? 'concept-map-node-current' : ''}`}>
    <button type="button" data-concept-map-node={id} aria-pressed={selected} onClick={() => onSelectConcept?.(id)} className="concept-map-node-button focus:outline-none focus:ring-2 focus:ring-cyan-500">
      <span className="concept-map-node-copy">
        <span className="concept-map-node-title">{conceptTitle(id, t)}</span>
        <span className="concept-map-node-state">{stateLabel(node.state, t)}</span>
      </span>
      {current && <Lumi presence="contextual" mode={nodeMode(node, graph)} />}
    </button>
  </div>;
}

function MapBody({ graph, snapshot, t, onSelectConcept, onSelectHypothesis }) {
  const nodes = graph?.nodes ?? [];
  const path = [...(graph?.pathConceptIds ?? [])];
  if (graph?.currentConceptId && !path.includes(graph.currentConceptId)) path.push(graph.currentConceptId);
  const selected = graph?.selectedConceptId;
  const evidenceIds = graph?.connectedEvidenceIds ?? [];
  const neighborIds = graph?.neighborConceptIds ?? [];
  const edges = graph?.edges ?? [];
  const hypothesisNodes = graph?.hypothesisNodes ?? [];
  const hypothesisEdges = graph?.hypothesisEdges ?? [];
  return <div className="concept-map-body">
    {nodes.length === 0 && hypothesisNodes.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">{t('playground.conceptMap.empty')}</p>}
    {(nodes.length > 0 || hypothesisNodes.length > 0) && <>
      <div className="concept-map-legend" aria-label={t('playground.conceptMap.legendLabel')}>
        {Object.values(CONCEPT_GRAPH_STATES).map((state) => <span key={state} className={`concept-map-legend-item ${nodeStateClass[state]}`}><span className="concept-map-legend-dot" aria-hidden="true" />{stateLabel(state, t)}</span>)}
      </div>
      {path.length > 0 && <section className="concept-map-path" aria-label={t('playground.conceptMap.pathLabel')}>
        <p className="concept-map-section-label">{t('playground.conceptMap.pathLabel')}</p>
        <div role="list" className="concept-map-path-list">
          {path.map((id, index) => <div key={id}>
            <ConceptNode id={id} graph={graph} t={t} onSelectConcept={onSelectConcept} />
            {index < path.length - 1 && <span className="concept-map-path-connector" aria-hidden="true" />}
          </div>)}
        </div>
      </section>}
      {graph?.frontierConceptIds?.length > 0 && <section className="concept-map-frontier" aria-label={t('playground.conceptMap.frontierLabel')}>
        <p className="concept-map-section-label">{t('playground.conceptMap.frontier')}</p>
        <div role="list" className="concept-map-frontier-list">
          {graph.frontierConceptIds.map((id) => <ConceptNode key={id} id={id} graph={graph} t={t} onSelectConcept={onSelectConcept} />)}
        </div>
      </section>}
      {edges.length > 0 && <section className="concept-map-edges" aria-label={t('playground.conceptMap.edgesLabel')}>
        <p className="concept-map-section-label">{t('playground.conceptMap.edgesLabel')}</p>
        <div role="list" className="concept-map-edge-list">
          {edges.map((edge) => {
            const highlighted = graph.highlightedConceptIds?.includes(edge.from) && graph.highlightedConceptIds?.includes(edge.to);
            const relationSemantics = conceptGraphRelationSemantics(edge.relation);
            return <div key={`${edge.from}:${edge.to}:${edge.relation}`} role="listitem" data-concept-map-edge={edge.relation} className={`concept-map-edge ${highlighted ? 'concept-map-edge-highlighted' : ''}`}>
              <button type="button" onClick={() => onSelectConcept?.(edge.from)} className="concept-map-edge-node focus:outline-none focus:ring-2 focus:ring-cyan-500">{conceptTitle(edge.from, t)}</button>
              <span data-concept-map-edge-direction={relationSemantics.directed ? 'directed' : 'undirected'} className={relationSemantics.directed ? 'concept-map-edge-arrow' : 'concept-map-edge-symmetric'} aria-hidden="true">{relationSemantics.directed ? '→' : '—'}</span>
              <button type="button" onClick={() => onSelectConcept?.(edge.to)} className="concept-map-edge-node focus:outline-none focus:ring-2 focus:ring-cyan-500">{conceptTitle(edge.to, t)}</button>
              <span className="concept-map-edge-relation">{relationKey[edge.relation] ? t(relationKey[edge.relation]) : edge.relation}</span>
            </div>;
          })}
        </div>
      </section>}
      {selected && <section className="concept-map-focus" aria-live="polite">
        <p className="concept-map-section-label">{t('playground.conceptMap.focusLabel')}</p>
        <p className="text-sm font-black text-slate-900">{conceptTitle(selected, t)}</p>
        {evidenceIds.length > 0 && <div className="mt-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('playground.conceptMap.evidenceLabel')}</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-700">{evidenceIds.map((id) => <li key={id} className="rounded-lg bg-cyan-50 px-2 py-1">{evidenceLabel(id, snapshot, t)}</li>)}</ul>
        </div>}
        {neighborIds.length > 0 && <div className="mt-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-purple-700">{t('playground.conceptMap.neighborLabel')}</p>
          <div className="mt-1 flex flex-wrap gap-1">{neighborIds.map((id) => <button key={id} type="button" onClick={() => onSelectConcept?.(id)} className="rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-bold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500">{conceptTitle(id, t)}</button>)}</div>
        </div>}
      </section>}
      {graph?.experimentRelation && <div className="concept-map-experiment" data-concept-map-experiment="true">
        <span className="concept-map-experiment-dot" aria-hidden="true" />
        <span>{t('playground.conceptMap.experimentRelation', { control: graph.experimentRelation.controlKey || t('playground.lumi.target.experiment') })}</span>
      </div>}
      {hypothesisNodes.length > 0 && <section className="concept-map-hypotheses" aria-label={t('playground.conceptMap.hypothesesLabel')}>
        <p className="concept-map-section-label">{t('playground.conceptMap.hypothesesLabel')}</p>
        <div className="concept-map-hypothesis-list" role="list">
          {hypothesisNodes.map((hypothesis) => <button key={hypothesis.id} type="button" role="listitem" data-concept-map-hypothesis={hypothesis.id} aria-pressed={graph.selectedHypothesisId === hypothesis.id} onClick={() => onSelectHypothesis?.(hypothesis.id)} className={`concept-map-hypothesis ${hypothesisStatusClass(hypothesis.status)} ${graph.selectedHypothesisId === hypothesis.id ? 'concept-map-hypothesis-selected' : ''} focus:outline-none focus:ring-2 focus:ring-purple-500`}>
            <span className="concept-map-hypothesis-title">{hypothesis.statement}</span>
            <span className="concept-map-hypothesis-meta">{t(`playground.hypothesis.status.${hypothesis.status}`)}</span>
          </button>)}
        </div>
        {hypothesisEdges.length > 0 && <div className="concept-map-hypothesis-links" role="list" aria-label={t('playground.conceptMap.hypothesisLinksLabel')}>
          {hypothesisEdges.map((edge) => <div key={`${edge.from}:${edge.to}:${edge.relation}`} role="listitem" className="concept-map-hypothesis-link">
            <span>{edge.relation === 'hypothesis_evidence' ? evidenceLabel(edge.to, snapshot, t) : conceptTitle(edge.from, t)}</span>
            <span aria-hidden="true">→</span>
            <span>{edge.relation === 'hypothesis_evidence' ? t('playground.conceptMap.evidenceLabel') : t('playground.conceptMap.hypothesisLabel')}</span>
          </div>)}
        </div>}
      </section>}
    </>}
  </div>;
}

export default function ConceptMap({ graph, snapshot, compact = false, t, onSelectConcept, onSelectHypothesis }) {
  const detailsRef = useRef(null);
  const [open, setOpen] = useState(Boolean(graph?.selectedConceptId));
  useEffect(() => {
    if (graph?.selectedConceptId) {
      setOpen(true);
      if (detailsRef.current) detailsRef.current.open = true;
    }
  }, [graph?.selectedConceptId]);
  const body = <MapBody graph={graph} snapshot={snapshot} t={t} onSelectConcept={onSelectConcept} onSelectHypothesis={onSelectHypothesis} />;
  if (compact) return <details ref={detailsRef} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-concept-map="true" className="concept-map rounded-2xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer list-none rounded-xl px-1 py-1 text-sm font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('playground.conceptMap.title')}</summary>
    <div className="mt-3">{body}</div>
  </details>;
  return <section data-concept-map="true" className="concept-map rounded-2xl border border-slate-200 bg-white p-3" aria-label={t('playground.conceptMap.ariaLabel')}>
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t('playground.lumi.name')}</p>
        <h3 className="text-sm font-black text-slate-900">{t('playground.conceptMap.title')}</h3>
      </div>
      <span className="text-[10px] font-bold text-slate-500">{t('playground.conceptMap.subtitle')}</span>
    </div>
    <div className="mt-3">{body}</div>
  </section>;
}
