import { useState } from 'react';
import { EXPLORATION_RECIPES, THINGS_TO_TRY } from '../../core/exploration/guidedExploration.js';

export default function GuidedExplore({ snapshot, onDispatch, onGuidanceChange, t }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);
  const select = (item) => {
    setActive(item);
    onGuidanceChange({ questionKey: item.questionKey, approachKey: item.approachKey, affordances: item.affordances });
  };
  const startRecipe = (recipe) => {
    const transaction = {
      id: `recipe-${recipe.id}-${crypto.randomUUID()}`,
      actor: 'human',
      intent: `recipe-setup-${recipe.id}`,
      operations: [
        { type: 'SET_WORLD_GENERATOR', spec: recipe.setup.spec, seed: recipe.setup.seed },
        { type: 'REGENERATE_WORLD', seed: recipe.setup.seed },
      ],
    };
    onDispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction });
    select(recipe);
  };
  return <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3" aria-label={t('playground.guidance.ariaLabel')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-sm font-black text-slate-900">{t('playground.guidance.title')}</button>
      {active && <button type="button" onClick={() => { setActive(null); onGuidanceChange(null); }} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-600 hover:bg-white">{t('playground.guidance.clear')}</button>}
    </div>
    {!open && <p className="mt-1 text-xs text-slate-500">{t('playground.guidance.quiet')}</p>}
    {open && <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div><p className="text-xs font-black uppercase tracking-wider text-slate-500">{t('playground.guidance.tryTitle')}</p><div className="mt-2 space-y-2">{THINGS_TO_TRY.map((item) => <button key={item.id} type="button" onClick={() => select(item)} className={`block w-full rounded-xl bg-white p-3 text-left text-xs font-bold text-slate-700 ring-1 ring-slate-200 ${active?.id === item.id ? 'ring-2 ring-blue-500' : ''}`}>{t(item.questionKey)}</button>)}</div></div>
      <div><p className="text-xs font-black uppercase tracking-wider text-slate-500">{t('playground.guidance.recipeTitle')}</p><div className="mt-2 space-y-2">{EXPLORATION_RECIPES.map((recipe) => <div key={recipe.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><p className="text-xs font-bold text-slate-700">{t(recipe.questionKey)}</p><button type="button" onClick={() => startRecipe(recipe)} className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white">{t('playground.guidance.startRecipe')}</button></div>)}</div></div>
    </div>}
    {active && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950"><p className="font-black">{t(active.questionKey)}</p><p className="mt-1">{t(active.approachKey)}</p><p className="mt-2 font-bold">{t('playground.guidance.highlighted')}: {active.affordances.join(', ')}</p></div>}
  </section>;
}
