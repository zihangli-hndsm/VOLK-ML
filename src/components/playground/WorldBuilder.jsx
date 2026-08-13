import { useMemo } from 'react';
import { normalizeGeneratorSpec } from '../../core/exploration/generator.js';

const DEFAULT_SPEC = normalizeGeneratorSpec({
  relation: { slope: 2, bias: 1 },
  noise: { amount: 0.5 },
  train: { input: { type: 'uniform', params: { min: -2, max: 2 } }, samples: 40 },
  test: { samples: 0 },
  outliers: { count: 0 },
});

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fieldsForInput(input) {
  return input.type === 'uniform'
    ? [['min', input.params.min], ['max', input.params.max]]
    : input.type === 'gaussian'
      ? [['mean', input.params.mean], ['spread', input.params.spread]]
      : [['centerA', input.params.centerA], ['centerB', input.params.centerB], ['spread', input.params.spread]];
}

export default function WorldBuilder({ snapshot, onDispatch, t }) {
  const world = snapshot.world;
  const activeSpec = world?.generator?.spec ?? DEFAULT_SPEC;
  const spec = useMemo(() => normalizeGeneratorSpec(activeSpec), [activeSpec]);
  const input = spec.train.input;
  const testInput = spec.test.input;
  const seed = world?.generator?.seed ?? world?.randomness?.seed ?? snapshot.seed ?? 42;
  const dispatchTransaction = (operations, intent = 'world-generator') => onDispatch({
    type: 'APPLY_WORLD_TRANSACTION',
    transaction: { id: `world-builder-${crypto.randomUUID()}`, actor: 'human', intent, operations },
  });
  const setParameter = (path, value) => {
    const operations = [{ type: 'SET_GENERATOR_PARAMETER', path, value }];
    if (!world.generator) operations.unshift({ type: 'SET_WORLD_GENERATOR', spec });
    dispatchTransaction(operations, 'set-generator-parameter');
  };
  const setInputType = (value) => {
    const operations = [{ type: 'SET_GENERATOR_PARAMETER', path: 'train.input.type', value }];
    if (!world.generator) operations.unshift({ type: 'SET_WORLD_GENERATOR', spec });
    dispatchTransaction(operations, 'set-generator-input');
  };
  const generate = () => {
    const operations = world.generator
      ? [{ type: 'REGENERATE_WORLD', seed: Number(seed) }]
      : [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: Number(seed) }];
    dispatchTransaction(operations, 'regenerate-world');
  };
  const inputFields = fieldsForInput(input);
  const testInputFields = fieldsForInput(testInput);
  const statusKey = world?.mode === 'generated'
    ? world.generator?.status === 'modified' ? 'playground.worldBuilder.modified'
      : world.generator?.status === 'dirty' ? 'playground.worldBuilder.dirty'
        : 'playground.worldBuilder.generated'
    : world?.generator && !world.generator.realization
      ? 'playground.worldBuilder.configured'
      : 'playground.worldBuilder.sample';
  const status = t(statusKey);
  return <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3" aria-label={t('playground.worldBuilder.ariaLabel')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-black text-slate-900">{t('playground.worldBuilder.title')}</h3>
        <p className="mt-1 text-xs text-slate-600">{t('playground.worldBuilder.instructions')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-black">
        <span className={`rounded-full px-2 py-1 ${world?.mode === 'generated' && world.generator?.status === 'clean' ? 'bg-indigo-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{status}</span>
        <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{t('playground.worldBuilder.seedBadge', { seed })}</span>
        <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{t('playground.worldBuilder.samplesBadge', { count: world?.observations?.length ?? 0 })}</span>
      </div>
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.input')}<select value={input.type} onChange={(event) => setInputType(event.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white p-2"><option value="uniform">{t('playground.worldBuilder.uniform')}</option><option value="gaussian">{t('playground.worldBuilder.gaussian')}</option><option value="two-cluster">{t('playground.worldBuilder.twoCluster')}</option></select></label>
      <div className="rounded-xl bg-white/80 p-2 ring-1 ring-indigo-100">
        <p className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.inputParameters')}</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {inputFields.map(([key, value]) => <label key={key} className="text-[11px] font-bold text-slate-500">{key}<input type="number" step="0.1" value={value} onChange={(event) => setParameter(`train.input.params.${key}`, numberValue(event.target.value, value))} className="mt-1 w-full rounded-lg border p-1.5 text-sm text-slate-800" /></label>)}
        </div>
      </div>
      <div className="rounded-xl bg-white/80 p-2 ring-1 ring-indigo-100">
        <p className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.relation')}</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className="text-[11px] font-bold text-slate-500">{t('playground.worldBuilder.slope')}<input type="number" step="0.1" value={spec.relation.slope} onChange={(event) => setParameter('relation.slope', numberValue(event.target.value, spec.relation.slope))} className="mt-1 w-full rounded-lg border p-1.5 text-sm text-slate-800" /></label>
          <label className="text-[11px] font-bold text-slate-500">{t('playground.worldBuilder.bias')}<input type="number" step="0.1" value={spec.relation.bias} onChange={(event) => setParameter('relation.bias', numberValue(event.target.value, spec.relation.bias))} className="mt-1 w-full rounded-lg border p-1.5 text-sm text-slate-800" /></label>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">y = {spec.relation.slope}x + {spec.relation.bias}</p>
      </div>
      <label className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.noise')}<input type="number" min="0" step="0.1" value={spec.noise.amount} onChange={(event) => setParameter('noise.amount', numberValue(event.target.value, spec.noise.amount))} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.samples')}<input type="number" min="2" max="500" step="1" value={spec.train.samples} onChange={(event) => setParameter('train.samples', Math.trunc(numberValue(event.target.value, spec.train.samples)))} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.outliers')}<input type="number" min="0" max={spec.train.samples + spec.test.samples} step="1" value={spec.outliers.count} onChange={(event) => setParameter('outliers.count', Math.trunc(numberValue(event.target.value, spec.outliers.count)))} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.seed')}<input type="number" step="1" value={seed} onChange={(event) => onDispatch({ type: 'SET_GENERATOR_SEED', seed: Math.trunc(numberValue(event.target.value, seed)) })} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white p-2" /></label>
      <div className="rounded-xl bg-white/80 p-2 ring-1 ring-indigo-100">
        <p className="text-xs font-bold text-slate-700">{t('playground.worldBuilder.testConfig')}</p>
        <div className="mt-1 grid gap-2">
          <label className="text-[11px] font-bold text-slate-500">{t('playground.worldBuilder.testInput')}<select value={spec.test.input.type} onChange={(event) => setParameter('test.input.type', event.target.value)} className="mt-1 w-full rounded-lg border p-1.5 text-sm text-slate-800"><option value="uniform">{t('playground.worldBuilder.uniform')}</option><option value="gaussian">{t('playground.worldBuilder.gaussian')}</option><option value="two-cluster">{t('playground.worldBuilder.twoCluster')}</option></select></label>
          <label className="text-[11px] font-bold text-slate-500">{t('playground.worldBuilder.testSamples')}<input type="number" min="0" max="500" value={spec.test.samples} onChange={(event) => setParameter('test.samples', Math.trunc(numberValue(event.target.value, spec.test.samples)))} className="mt-1 w-full rounded-lg border p-1.5 text-sm text-slate-800" /></label>
          <div className="grid grid-cols-2 gap-2">
            {testInputFields.map(([key, value]) => <label key={key} className="text-[11px] font-bold text-slate-500">{key}<input type="number" step="0.1" value={value} onChange={(event) => setParameter(`test.input.params.${key}`, numberValue(event.target.value, value))} className="mt-1 w-full rounded-lg border p-1.5 text-sm text-slate-800" /></label>)}
          </div>
        </div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={generate} className="rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white">{t('playground.worldBuilder.regenerate')}</button>
      {world?.mode === 'generated' && <button type="button" onClick={() => onDispatch({ type: 'FREEZE_AS_SAMPLES' })} className="rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-indigo-200">{t('playground.worldBuilder.freeze')}</button>}
      {world?.mode === 'generated' && world.generator?.status === 'dirty' && <span className="self-center text-xs font-bold text-amber-700">{t('playground.worldBuilder.dirtyHint')}</span>}
      {world?.mode === 'sample' && world.generator && !world.generator.realization && <span className="self-center text-xs font-bold text-slate-600">{t('playground.worldBuilder.configuredHint')}</span>}
    </div>
  </section>;
}
