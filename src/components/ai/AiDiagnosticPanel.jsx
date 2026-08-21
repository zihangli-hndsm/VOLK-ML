import { diagnosticText } from '../../core/ai/diagnostics.js';

export default function AiDiagnosticPanel({ diagnostic, trace = [], t, fallback = false }) {
  if (!diagnostic) return null;
  const recent = Array.isArray(trace) ? trace.slice(-1)[0] : null;
  const copy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(diagnosticText(diagnostic));
  };
  return <section role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950" data-ai-diagnostic="true">
    <p className="font-black">{fallback ? t('ai.diagnosticFallback') : t(`ai.diagnostic.${diagnostic.errorCode}`)}</p>
    <details className="mt-1">
      <summary className="cursor-pointer font-black">{t('ai.showDetails')}</summary>
      <dl className="mt-2 grid gap-1 sm:grid-cols-2">
        <div><dt className="font-bold">{t('ai.diagnosticStage')}</dt><dd>{diagnostic.stage}</dd></div>
        <div><dt className="font-bold">{t('ai.diagnosticCode')}</dt><dd>{diagnostic.errorCode}</dd></div>
        <div><dt className="font-bold">{t('ai.diagnosticProvider')}</dt><dd>{diagnostic.vendor ?? diagnostic.protocol ?? '—'}</dd></div>
        <div><dt className="font-bold">{t('ai.diagnosticModel')}</dt><dd>{diagnostic.model ?? '—'}</dd></div>
        <div><dt className="font-bold">{t('ai.diagnosticEndpoint')}</dt><dd>{diagnostic.endpoint ?? '—'}</dd></div>
        <div><dt className="font-bold">{t('ai.diagnosticStatus')}</dt><dd>{diagnostic.httpStatus ?? '—'}</dd></div>
      </dl>
      <p className="mt-2 whitespace-pre-wrap">{diagnostic.providerMessage || '—'}</p>
      <p className="mt-1 text-[10px]">{t('ai.diagnosticFallbackUsed')}: {diagnostic.fallbackUsed ? t('ai.yes') : t('ai.no')}</p>
      {recent && <p className="mt-1 font-mono text-[10px]">{t('ai.diagnosticRecentTrace')}: {recent.stage} · {recent.status}</p>}
      <button type="button" onClick={copy} className="mt-2 rounded-lg bg-white px-2 py-1 font-black ring-1 ring-amber-200">{t('ai.copyDiagnostics')}</button>
    </details>
  </section>;
}
