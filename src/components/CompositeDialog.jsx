import React, { useState } from 'react';

const colors = ['#8b5cf6', '#2563eb', '#10b981', '#f97316', '#ec4899', '#0f172a'];

export default function CompositeDialog({ open, selectedCount, onClose, onCreate, t }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(colors[0]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-4" onMouseDown={onClose}>
    <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">{t('composite.createTitle')}</h2><p className="mt-1 text-sm text-slate-500">{t('composite.selectedCount', { count: selectedCount })}</p></div><button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold">✕</button></div>
      <label className="mt-5 block text-sm font-bold text-slate-700">{t('composite.name')}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-violet-500" /></label>
      <div className="mt-5"><p className="text-sm font-bold text-slate-700">{t('composite.color')}</p><div className="mt-2 flex flex-wrap gap-2">{colors.map((item) => <button key={item} aria-label={item} onClick={() => setColor(item)} style={{ backgroundColor: item }} className={`h-10 w-10 rounded-full border-4 ${color === item ? 'border-slate-950' : 'border-white'}`} />)}</div></div>
      <button disabled={!name.trim() || selectedCount < 2} onClick={() => { onCreate({ name: name.trim(), color }); setName(''); }} className="mt-6 w-full rounded-2xl bg-violet-600 px-4 py-3 font-bold text-white disabled:opacity-40">{t('composite.create')}</button>
    </section>
  </div>;
}
