import Lumi from './Lumi.jsx';
import { getInquiryConcept } from '../../core/exploration/learnerInquiry.js';
import { LUMI_JOURNEY_EVENT_TYPES } from '../../core/ui/lumiJourney.js';

const eventMode = {
  [LUMI_JOURNEY_EVENT_TYPES.OBSERVE]: 'observe',
  [LUMI_JOURNEY_EVENT_TYPES.INTERVENE]: 'intervene',
  [LUMI_JOURNEY_EVENT_TYPES.CONNECT]: 'explore',
  [LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE]: 'illuminate',
};

const eventColor = {
  [LUMI_JOURNEY_EVENT_TYPES.OBSERVE]: 'lumi-journey-observe',
  [LUMI_JOURNEY_EVENT_TYPES.INTERVENE]: 'lumi-journey-intervene',
  [LUMI_JOURNEY_EVENT_TYPES.CONNECT]: 'lumi-journey-connect',
  [LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE]: 'lumi-journey-illuminate',
};

const eventLabelKey = {
  [LUMI_JOURNEY_EVENT_TYPES.OBSERVE]: 'playground.lumi.journey.event.observe',
  [LUMI_JOURNEY_EVENT_TYPES.INTERVENE]: 'playground.lumi.journey.event.intervene',
  [LUMI_JOURNEY_EVENT_TYPES.CONNECT]: 'playground.lumi.journey.event.connect',
  [LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE]: 'playground.lumi.journey.event.illuminate',
};

function targetLabel(event, snapshot, t) {
  if (event.type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE || event.type === LUMI_JOURNEY_EVENT_TYPES.CONNECT) {
    const notice = (snapshot?.observations ?? []).find((item) => String(item?.id ?? '') === String(event.evidenceId));
    if (event.type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE) return notice?.messageKey ? t(notice.messageKey) : t('playground.lumi.target.evidence');
    const concept = getInquiryConcept(event.conceptId);
    return concept?.titleKey ? t(concept.titleKey) : t('playground.lumi.target.concept');
  }
  if (event.type === LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE) {
    const concept = getInquiryConcept(event.conceptId);
    return concept?.titleKey ? t(concept.titleKey) : t('playground.lumi.target.concept');
  }
  return t('playground.lumi.target.experiment');
}

function JourneyNode({ event, current, snapshot, t, onSelectConcept }) {
  const isCurrent = current?.id === event.id;
  const selectable = (event.type === LUMI_JOURNEY_EVENT_TYPES.CONNECT || event.type === LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE) && event.conceptId;
  const content = <>
    <span className="lumi-journey-node-mark" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-xs font-black">{t(eventLabelKey[event.type])}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-600">{targetLabel(event, snapshot, t)}</p>
    </div>
    {isCurrent && <Lumi presence="contextual" mode={eventMode[event.type]} />}
  </>;
  return <div data-lumi-journey-event={event.type} data-lumi-current={isCurrent ? 'true' : undefined} role="listitem">
    {selectable ? <button type="button" data-lumi-journey-concept={event.conceptId} onClick={() => onSelectConcept?.(event.conceptId)} className={`lumi-journey-node lumi-journey-node-button w-full text-left ${eventColor[event.type]} ${isCurrent ? 'lumi-journey-node-current' : ''} focus:outline-none focus:ring-2 focus:ring-purple-500`}>{content}</button> : <div className={`lumi-journey-node ${eventColor[event.type]} ${isCurrent ? 'lumi-journey-node-current' : ''}`}>{content}</div>}
  </div>;
}

function TimelineBody({ journey, snapshot, t, onSelectConcept }) {
  const events = journey?.events ?? [];
  const current = journey?.currentEvent;
  const frontier = journey?.frontierConceptIds ?? [];
  return <div className="lumi-journey-body">
    {events.length === 0 && frontier.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">{t('playground.lumi.journey.empty')}</p>}
    {events.length > 0 && <div role="list" aria-label={t('playground.lumi.journey.eventsLabel')} className="lumi-journey-events">
      {events.map((event, index) => <div key={event.id}>
        <JourneyNode event={event} current={current} snapshot={snapshot} t={t} onSelectConcept={onSelectConcept} />
        {index < events.length - 1 && <span className="lumi-journey-connector" aria-hidden="true" />}
      </div>)}
    </div>}
    {frontier.length > 0 && <div className="mt-3 border-t border-purple-100 pt-3">
      <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-purple-700">{t('playground.lumi.journey.frontier')}</p>
      <div role="list" aria-label={t('playground.lumi.journey.frontierLabel')} className="space-y-2">
        {frontier.map((conceptId) => {
          const concept = getInquiryConcept(conceptId);
          return <button type="button" key={conceptId} data-lumi-journey-frontier={conceptId} onClick={() => onSelectConcept?.(conceptId)} role="listitem" className="lumi-journey-frontier w-full rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs font-black text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-500">
            <Lumi presence="ambient" mode="explore" />
            <span>{concept?.titleKey ? t(concept.titleKey) : t('playground.lumi.target.concept')}</span>
          </button>;
        })}
      </div>
    </div>}
  </div>;
}

export default function LumiJourneyTimeline({ journey, snapshot, compact = false, t, onSelectConcept }) {
  const body = <TimelineBody journey={journey} snapshot={snapshot} t={t} onSelectConcept={onSelectConcept} />;
  if (compact) return <details data-lumi-journey="true" className="lumi-journey-timeline rounded-2xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer list-none rounded-xl px-1 py-1 text-sm font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('playground.lumi.journey.title')}</summary>
    <div className="mt-3">{body}</div>
  </details>;
  return <section data-lumi-journey="true" className="lumi-journey-timeline rounded-2xl border border-slate-200 bg-white p-3" aria-label={t('playground.lumi.journey.ariaLabel')}>
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t('playground.lumi.name')}</p>
        <h3 className="text-sm font-black text-slate-900">{t('playground.lumi.journey.title')}</h3>
      </div>
      <span className="text-[10px] font-bold text-slate-500">{t('playground.lumi.journey.current')}</span>
    </div>
    <div className="mt-3">{body}</div>
  </section>;
}
