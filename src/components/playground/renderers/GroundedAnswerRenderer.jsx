export default function GroundedAnswerRenderer({ props, t }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  return <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-slate-700" data-grounded-answer>
    <p className="text-[11px] font-black uppercase tracking-wide text-indigo-700">{translate('playground.groundedAnswer.title')}</p>
    <p className="mt-1 leading-6">{props.text}</p>
    <p className="mt-2 text-xs text-slate-500">{translate('playground.groundedAnswer.sources')}: {(props.sourceIds ?? []).join(', ') || translate('playground.groundedAnswer.none')} · {translate('playground.groundedAnswer.query')}: {props.query}</p>
  </section>;
}
