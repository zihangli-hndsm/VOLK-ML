export default function LearningContextDisclosure({ context, selection, onClearSelection, t }) {
  if (!context) return null;
  const annotations = Array.isArray(context.annotations) ? context.annotations : [];
  const understood = annotations.filter((item) => item.kind === 'understood').length;
  const unclear = annotations.filter((item) => item.kind === 'unclear').length;
  return <details className="mt-3 rounded-xl border border-slate-200 bg-white p-2 text-xs" data-learning-context="true">
    <summary className="cursor-pointer font-black text-slate-700">{t('ai.contextTitle')}</summary>
    <p className="mt-2 text-slate-500">{t('ai.contextDescription')}</p>
    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
      <div><dt className="font-bold text-slate-500">{t('ai.contextWorld')}</dt><dd>{[context.playground?.task, context.playground?.modelKind].filter(Boolean).join(' · ') || t('ai.contextNone')}</dd></div>
      <div><dt className="font-bold text-slate-500">{t('ai.contextDepth')}</dt><dd>{context.currentDepth || t('ai.contextNone')}</dd></div>
      <div><dt className="font-bold text-slate-500">{t('ai.contextConcepts')}</dt><dd>{context.conceptIds?.join(', ') || t('ai.contextNone')}</dd></div>
      <div><dt className="font-bold text-slate-500">{t('ai.contextComparison')}</dt><dd>{context.comparison?.active ? [context.comparison.clarity, context.comparison.changedFactors?.join(', ')].filter(Boolean).join(' · ') : t('ai.contextComparisonOff')}</dd></div>
      <div><dt className="font-bold text-slate-500">{t('ai.contextMarked')}</dt><dd>{t('ai.annotationUnderstood')}: {understood} · {t('ai.annotationUnclear')}: {unclear}</dd></div>
      <div className="sm:col-span-2"><dt className="font-bold text-slate-500">{t('ai.contextSelected')}</dt><dd>{selection?.quote || t('ai.contextNone')}{selection?.quote && <button type="button" onClick={onClearSelection} className="ml-2 rounded-lg px-2 py-1 font-bold text-violet-700 ring-1 ring-violet-200">{t('ai.contextRemoveSelection')}</button>}</dd></div>
    </dl>
  </details>;
}
