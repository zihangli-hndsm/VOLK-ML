import React, { useEffect, useMemo, useState } from 'react';
import { componentLibraryTree } from '../core/visualLanguage.js';

const categoryKey = (groupId, category) => `${groupId}:${category}`;

export default function ComponentLibrary({
  plugins,
  query,
  mode,
  onAdd,
  onTutorial,
  onDeleteCustom,
  t,
}) {
  const tree = useMemo(() => componentLibraryTree(plugins), [plugins]);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(['data', 'model', 'custom']));
  const [expandedCategories, setExpandedCategories] = useState(() => new Set([
    'data:Data',
    'model:Core',
    'model:Models',
  ]));
  const searching = Boolean(query.trim());

  useEffect(() => {
    if (!searching) return;
    setExpandedGroups(new Set(tree.map((group) => group.id)));
    setExpandedCategories(new Set(tree.flatMap((group) => (
      group.categories.map((category) => categoryKey(group.id, category.id))
    ))));
  }, [searching, tree]);

  const toggle = (setter, key) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return <div className="mt-4 space-y-2">
    {tree.map((group) => {
      const groupOpen = expandedGroups.has(group.id);
      return <section key={group.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80">
        <button
          onClick={() => toggle(setExpandedGroups, group.id)}
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
          aria-expanded={groupOpen}
        >
          <span className="flex items-center gap-2"><span className="text-xs text-slate-400">{groupOpen ? '▼' : '▶'}</span><span className="font-black text-slate-800">{t(group.labelKey)}</span></span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{group.count}</span>
        </button>
        {groupOpen && <div className="border-t border-slate-100 px-2 pb-2">
          {group.categories.map((category) => {
            const key = categoryKey(group.id, category.id);
            const categoryOpen = expandedCategories.has(key);
            return <div key={key} className="mt-2">
              <button
                onClick={() => toggle(setExpandedCategories, key)}
                className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
                aria-expanded={categoryOpen}
              >
                <span>{categoryOpen ? '−' : '+'} {t(`category.${category.id}`)}</span><span>{category.plugins.length}</span>
              </button>
              {categoryOpen && <div className="mt-1 space-y-2 border-l-2 border-slate-100 pl-2">
                {category.plugins.map((plugin) => <div
                  key={plugin.id}
                  className={`flex items-start gap-2 rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-blue-400 ${mode === 'compact' ? 'p-2' : 'p-3'}`}
                  style={plugin.color ? { borderLeftWidth: 5, borderLeftColor: plugin.color } : undefined}
                >
                  <button onClick={() => onAdd(plugin)} className="min-w-0 flex-1 text-left">
                    <span className="block break-words font-semibold text-slate-900">{t(plugin.name)}</span>
                    {plugin.customComposite && <span className="mt-1 block text-[10px] font-bold uppercase text-violet-600">{t('library.custom')}</span>}
                    {mode === 'detailed' && <span className="mt-1 block break-words text-xs text-slate-500">{t(plugin.description)}</span>}
                  </button>
                  {plugin.customComposite ? <button
                    aria-label={t('library.deleteCustom')}
                    title={t('library.deleteCustom')}
                    onClick={() => onDeleteCustom(plugin)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 font-bold text-red-600 hover:bg-red-100"
                  >⌫</button> : <button
                    aria-label={t('tutorial.learn')}
                    title={t('tutorial.learn')}
                    onClick={() => onTutorial(plugin)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 font-black text-blue-700 hover:bg-blue-100"
                  >?</button>}
                </div>)}
              </div>}
            </div>;
          })}
        </div>}
      </section>;
    })}
  </div>;
}
