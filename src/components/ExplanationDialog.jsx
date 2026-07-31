import React, { useMemo, useState } from 'react';
import { analyzeProject, askExplanationAgent } from '../core/explanation.js';
import { stageStyles } from '../core/visualLanguage.js';

export default function ExplanationDialog({ open, nodes, edges, language, onClose, t }) {
  const analysis = useMemo(() => analyzeProject(nodes, edges), [nodes, edges]);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]);
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1/chat/completions');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  if (!open) return null;
  const ask = async () => {
    if (!question.trim()) return;
    if (!apiKey || !model) {
      const localAnswer = t('agent.localAnswer', {
        nodes: analysis.nodeCount,
        edges: analysis.edgeCount,
        missing: analysis.missingInputs.length,
      });
      setHistory((current) => [...current, { role: 'user', content: question }, { role: 'assistant', content: localAnswer }]);
      setQuestion('');
      return;
    }
    setLoading(true);
    try {
      const answer = await askExplanationAgent({
        analysis,
        question,
        endpoint,
        apiKey,
        model,
        language,
        history,
      });
      setHistory((current) => [...current, { role: 'user', content: question }, { role: 'assistant', content: answer }]);
      setQuestion('');
    } catch (error) {
      setHistory((current) => [...current, { role: 'user', content: question }, { role: 'assistant', content: t('agent.requestFailed', { message: error.message }) }]);
    } finally {
      setLoading(false);
    }
  };
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section className="grid max-h-[94vh] w-full max-w-6xl gap-5 overflow-auto rounded-3xl bg-white p-5 shadow-2xl lg:grid-cols-[1.15fr_0.85fr]" onMouseDown={(event) => event.stopPropagation()}>
      <div>
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-black">{t('agent.title')}</h2><p className="mt-1 text-sm text-slate-500">{t('agent.description')}</p></div><button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold">✕</button></div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(analysis.stages).map(([stage, count]) => <div key={stage} className={`rounded-2xl p-3 ${stageStyles[stage].soft}`}><p className={`text-xs font-bold ${stageStyles[stage].text}`}>{t(`stage.${stage}`)}</p><p className="mt-1 text-2xl font-black">{count}</p></div>)}</div>
        <div className="mt-5 space-y-3">{analysis.steps.map((step, index) => <div key={step.id} className="flex gap-3 rounded-2xl border border-slate-200 p-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${stageStyles[step.stage].soft} ${stageStyles[step.stage].text}`}>{index + 1}</span><div><p className="font-bold">{t(step.name)}</p><p className="mt-1 text-sm leading-6 text-slate-600">{t(step.description)}</p></div></div>)}</div>
        {analysis.missingInputs.length > 0 && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{t('agent.missingInputs', { count: analysis.missingInputs.length })}</div>}
      </div>
      <div className="rounded-3xl bg-slate-950 p-5 text-white">
        <h3 className="text-lg font-black">{t('agent.askTitle')}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{t('agent.privacy')}</p>
        <details className="mt-4 rounded-2xl bg-white/5 p-3"><summary className="cursor-pointer text-sm font-bold">{t('agent.apiSettings')}</summary><div className="mt-3 space-y-2"><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={t('agent.endpoint')} className="w-full rounded-xl border border-white/10 bg-white/10 p-2 text-sm outline-none" /><input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('agent.model')} className="w-full rounded-xl border border-white/10 bg-white/10 p-2 text-sm outline-none" /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('agent.apiKey')} className="w-full rounded-xl border border-white/10 bg-white/10 p-2 text-sm outline-none" /></div></details>
        {history.length > 0 && <div className="mt-4 max-h-64 space-y-2 overflow-auto">{history.map((message, index) => <div key={index} className={`whitespace-pre-wrap rounded-2xl p-3 text-sm leading-6 ${message.role === 'user' ? 'ml-8 bg-blue-500 text-white' : 'mr-8 bg-white text-slate-800'}`}>{message.content}</div>)}</div>}
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('agent.questionPlaceholder')} className="mt-4 min-h-28 w-full rounded-2xl border border-white/10 bg-white/10 p-3 text-sm outline-none" />
        <button disabled={loading || !question.trim()} onClick={ask} className="mt-3 w-full rounded-2xl bg-blue-500 px-4 py-3 font-bold disabled:opacity-40">{loading ? t('agent.thinking') : t('agent.ask')}</button>
      </div>
    </section>
  </div>;
}
