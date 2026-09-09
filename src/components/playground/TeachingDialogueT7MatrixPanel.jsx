import { useMemo, useState } from 'react';

const DEFAULT_REVISION = import.meta.env.VITE_VOLK_ML_REVISION || 'dev-local';

export default function TeachingDialogueT7MatrixPanel({ driver, t }) {
  const [revision, setRevision] = useState(DEFAULT_REVISION);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 24 });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [failed, setFailed] = useState(false);
  const total = useMemo(() => (driver?.caseIds?.length ?? 12) * 2, [driver?.caseIds?.length]);

  if (!driver) return null;
  const run = async () => {
    if (running || !revision.trim()) return;
    setRunning(true);
    setFailed(false);
    setRows([]);
    setSummary(null);
    setProgress({ completed: 0, total });
    try {
      const result = await driver.run({
        revision: revision.trim(),
        onRow: (row, nextProgress) => {
          setRows((current) => [...current, row].slice(-24));
          setProgress(nextProgress);
        },
      });
      setSummary(result);
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };

  return <section data-t7-matrix-panel className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="font-black">{t('phaseA.debug.title')}</p><p className="mt-1 text-[11px]">{t('phaseA.debug.body')}</p></div>
      <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase">{t('phaseA.debug.title')}</span>
    </div>
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1 text-[11px] font-bold">{t('playground.agent.reviseTitle')}<input aria-label={t('playground.agent.reviseTitle')} value={revision} maxLength={80} onChange={(event) => setRevision(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 font-mono text-[11px]" /></label>
      <button type="button" disabled={running || !revision.trim()} onClick={run} className="rounded-lg bg-amber-700 px-3 py-2 font-black text-white disabled:opacity-40">{t('playground.agent.run')}</button>
    </div>
    {(running || summary) && <p className="mt-2 font-bold" role="status">{t('playground.agent.providerStatus', { provider: 'T7', status: `${progress.completed}/${progress.total}` })}</p>}
    {failed && <p className="mt-2 font-bold text-red-800">{t('playground.agent.fidelityFailed')}</p>}
    {summary && <div className="mt-2 rounded-lg border border-amber-200 bg-white p-2"><p className="font-black">{t(summary.failed === 0 ? 'playground.agent.fidelityPassed' : 'playground.agent.fidelityFailed')}</p><p className="mt-1 font-mono text-[11px]">{t('playground.agent.fidelityPassed')}: {summary.passed} · {t('playground.agent.fidelityFailed')}: {summary.failed}</p></div>}
    {rows.length > 0 && <div className="mt-2 max-h-52 overflow-auto rounded-lg border border-amber-100 bg-white"><table className="w-full text-left text-[10px]"><thead className="sticky top-0 bg-amber-100"><tr><th className="p-1">{t('playground.agent.steps')}</th><th className="p-1">{t('playground.agent.active')}</th><th className="p-1">{t('playground.agent.provider')}</th><th className="p-1">{t('playground.agent.operations')}</th><th className="p-1">{t('playground.agent.preview')}</th><th className="p-1">{t('playground.agent.fidelity')}</th><th className="p-1">{t('playground.agent.localMode')}</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.caseId}-${row.run}`} className="border-t border-amber-50"><td className="p-1 font-mono">{row.caseId}</td><td className="p-1">{row.run}</td><td className="p-1">{row.origin}</td><td className="p-1 font-mono">{row.move}</td><td className="p-1 font-mono" data-t7-content-key={row.contentKey}>{row.contentKey}</td><td className="p-1 font-mono">{Object.values(row.scores).join('/')}</td><td className="p-1" data-t7-failure-categories={row.failureCategories.join(',')}>{row.failureCategories.join(', ') || row.status}</td></tr>)}</tbody></table></div>}
  </section>;
}
