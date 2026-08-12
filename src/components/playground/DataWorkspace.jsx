import { useMemo, useRef, useState } from 'react';
import {
  materializeWorldGesture,
  MAX_GESTURE_PATH_POINTS,
} from '../../core/exploration/gestures.js';
import {
  getProjectedValue,
  observationFromProjection,
  projectObservation,
  projectedBounds,
} from '../../core/exploration/projection.js';

const PLOT = { left: 42, right: 620, top: 18, bottom: 320 };
const TOOLS = ['point', 'brush', 'spray', 'select', 'erase'];

function initialBounds(snapshot) {
  return snapshot.viewState?.bounds ?? snapshot.scene?.ranges ?? {
    xMin: -1, xMax: 1, yMin: -1, yMax: 1,
  };
}

function visibleMembership(point) {
  return point.membership === 'test' ? 'test' : 'train';
}

function pointInLayer(point, visibility) {
  return visibility === 'both' || visibleMembership(point) === visibility;
}

function DistributionView({ points, feature, t }) {
  const values = points.map((point) => getProjectedValue(point, feature)).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1, max - min);
  const binsFor = (membership) => {
    const bins = Array.from({ length: 10 }, () => 0);
    points.filter((point) => membership === 'both' || visibleMembership(point) === membership).forEach((point) => {
      const value = getProjectedValue(point, feature);
      if (Number.isFinite(value)) bins[Math.min(9, Math.floor(((value - min) / span) * 10))] += 1;
    });
    return bins;
  };
  const trainBins = binsFor('train');
  const testBins = binsFor('test');
  const peak = Math.max(1, ...trainBins, ...testBins);
  return <svg viewBox="0 0 640 360" className="block h-auto w-full" role="img" aria-label={t('playground.workspace.distributionAria')}>
    <rect width="640" height="360" fill="white" />
    <defs><pattern id="test-bars" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y1="0" y2="6" stroke="#7c3aed" strokeWidth="2" /></pattern></defs>
    {trainBins.map((count, index) => <rect key={`train-${index}`} x={52 + index * 55} y={320 - (count / peak) * 250} width="44" height={(count / peak) * 250} fill="#16a34a" opacity="0.78" />)}
    {testBins.map((count, index) => <rect key={`test-${index}`} x={52 + index * 55} y={320 - (count / peak) * 250} width="44" height={(count / peak) * 250} fill="url(#test-bars)" stroke="#7c3aed" />)}
    <path d="M42 320 H620" stroke="#475569" strokeWidth="2" />
    <text x="52" y="22" fontSize="11" fontWeight="700" fill="#15803d">{t('playground.workspace.layer.train')}</text>
    <text x="112" y="22" fontSize="11" fontWeight="700" fill="#6d28d9">{t('playground.workspace.layer.test')}</text>
    <text x="331" y="350" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{feature}</text>
    <text x="18" y="180" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 18 180)">{t('playground.workspace.count')}</text>
    <text x="52" y="338" fontSize="11" fill="#64748b">{min.toFixed(2)}</text>
    <text x="575" y="338" fontSize="11" fill="#64748b">{max.toFixed(2)}</text>
  </svg>;
}

export default function DataWorkspace({ snapshot, onDispatch, t }) {
  const svgRef = useRef(null);
  const gestureRef = useRef(null);
  const dragRef = useRef(null);
  const counterRef = useRef(0);
  const [tool, setTool] = useState('point');
  const [layer, setLayer] = useState('train');
  const [spread, setSpread] = useState(0.12);
  const [density, setDensity] = useState(6);
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode, setViewMode] = useState(snapshot.viewState?.mode ?? 'scatter');
  const [xFeature, setXFeature] = useState(snapshot.viewState?.xFeature ?? snapshot.world?.featureNames?.[0] ?? 'x');
  const [yFeature, setYFeature] = useState(snapshot.viewState?.yFeature ?? snapshot.world?.featureNames?.[1] ?? 'y');
  const [interventionFeature, setInterventionFeature] = useState(xFeature);
  const [interventionKind, setInterventionKind] = useState('shift');
  const [interventionScope, setInterventionScope] = useState('all');
  const [interventionAmount, setInterventionAmount] = useState(0.2);
  const [interventionSeed, setInterventionSeed] = useState(7);
  const [draftPoint, setDraftPoint] = useState(null);
  const [preciseX, setPreciseX] = useState('');
  const [preciseY, setPreciseY] = useState('');
  const [error, setError] = useState(null);
  const [previewPath, setPreviewPath] = useState([]);
  const world = snapshot.world;
  const baseBounds = initialBounds(snapshot);
  const operations = new Set((snapshot.capabilities?.worldOperations ?? []).map((item) => item.type));
  const canEdit = Boolean(snapshot.capabilities?.canEditWorld)
    && operations.has('ADD_POINTS')
    && operations.has('MOVE_POINT')
    && operations.has('REMOVE_POINT')
    && operations.has('REMOVE_POINTS')
    && operations.has('SET_TRAIN_TEST_MEMBERSHIP');
  const points = world?.observations ?? [];
  const featureNames = world?.featureNames ?? ['x', 'y'];
  const projectedPoints = points.map((point) => projectObservation(point, xFeature, yFeature))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const projectedViewBounds = projectedBounds(points, xFeature, yFeature);
  const bounds = viewMode === 'scatter' ? projectedViewBounds : baseBounds;
  const canCreateObservation = Boolean(snapshot.capabilities?.canCreateObservationFromProjection);
  const creationUnavailableMessage = world?.task === 'classification'
    ? t('playground.workspace.classificationLabelRequired')
    : t('playground.workspace.drawingUnavailable');
  const visiblePoints = useMemo(
    () => points.filter((point) => pointInLayer(point, snapshot.viewState?.visibility ?? 'both')),
    [points, snapshot.viewState?.visibility],
  );
  const counts = useMemo(() => points.reduce((result, point) => {
    result[visibleMembership(point)] += 1;
    return result;
  }, { train: 0, test: 0 }), [points]);

  if (!canEdit) return null;

  const xToSvg = (x) => PLOT.left + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * (PLOT.right - PLOT.left);
  const yToSvg = (y) => PLOT.bottom - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin)) * (PLOT.bottom - PLOT.top);
  const svgToWorld = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const x = (event.clientX - rect.left) / rect.width * 640;
    const y = (event.clientY - rect.top) / rect.height * 360;
    return {
      x: bounds.xMin + ((x - PLOT.left) / (PLOT.right - PLOT.left)) * (bounds.xMax - bounds.xMin),
      y: bounds.yMax - ((y - PLOT.top) / (PLOT.bottom - PLOT.top)) * (bounds.yMax - bounds.yMin),
    };
  };
  const hitRadius = Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * 0.035;
  const nearestPoint = (position) => visiblePoints
    .map((point) => {
      const projected = projectObservation(point, xFeature, yFeature);
      return { point, distance: Math.hypot(projected.x - position.x, projected.y - position.y) };
    })
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((a, b) => a.distance - b.distance)[0];
  const dispatchTransaction = (transaction) => {
    setError(null);
    Promise.resolve(onDispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction })).catch((nextError) => setError(nextError));
  };
  const nextGestureId = (name) => `workspace-${name}-${counterRef.current++}`;
  const finishGesture = (event) => {
    const position = svgToWorld(event);
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setPreviewPath([]);
    if (!gesture || gesture.failed || !position) return;
    const path = [...gesture.path, position];
    try {
      if (gesture.tool === 'brush' || gesture.tool === 'spray') {
        dispatchTransaction(materializeWorldGesture({
          id: gesture.id,
          tool: gesture.tool,
          path,
          seed: snapshot.world.randomness?.seed ?? snapshot.seed ?? 0,
          spread,
          density,
          membership: layer,
          provenance: 'manual',
          existingPointCount: points.length,
        }));
      } else if (gesture.tool === 'erase') {
        const ids = new Set(points.filter((point) => path.some((sample) => (
          Math.hypot(
            getProjectedValue(point, xFeature) - sample.x,
            getProjectedValue(point, yFeature) - sample.y,
          ) <= hitRadius
        ))).map((point) => point.id));
        if (ids.size) {
          dispatchTransaction({
            id: gesture.id,
            actor: 'human',
            intent: 'erase',
            operations: [{
              type: ids.size === 1 ? 'REMOVE_POINT' : 'REMOVE_POINTS',
              ...(ids.size === 1 ? { pointId: [...ids][0] } : { pointIds: [...ids] }),
            }],
          });
        }
      } else if (gesture.tool === 'point') {
        const point = observationFromProjection(world, {
          xFeature,
          yFeature,
          x: position.x,
          y: position.y,
          membership: layer,
          provenance: 'manual',
        });
        if (!point) {
          setError(creationUnavailableMessage);
          return;
        }
        dispatchTransaction({
          id: gesture.id,
          actor: 'human',
          intent: 'point',
          operations: [{
            type: 'ADD_POINTS',
            points: [point],
          }],
        });
      }
    } catch (nextError) {
      setError(nextError);
    }
  };
  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const position = svgToWorld(event);
    if (!position) return;
    if ((tool === 'point' || tool === 'brush' || tool === 'spray') && !canCreateObservation) {
      setError(creationUnavailableMessage);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setError(null);
    if (tool === 'select') {
      const hit = nearestPoint(position);
      if (!hit || hit.distance > hitRadius) {
        setSelectedId(null);
        return;
      }
      setSelectedId(hit.point.id);
      setPreciseX(String(getProjectedValue(hit.point, xFeature)));
      setPreciseY(String(getProjectedValue(hit.point, yFeature)));
      dragRef.current = { id: hit.point.id, start: position, current: position };
      return;
    }
    gestureRef.current = {
      id: nextGestureId(tool),
      tool,
      path: [position],
      failed: false,
    };
    setPreviewPath([position]);
  };
  const onPointerMove = (event) => {
    const position = svgToWorld(event);
    if (!position) return;
    if (dragRef.current) {
      dragRef.current.current = position;
      setDraftPoint({ id: dragRef.current.id, ...position });
      return;
    }
    if (!gestureRef.current) return;
    if (gestureRef.current.path.length >= MAX_GESTURE_PATH_POINTS) {
      gestureRef.current.failed = true;
      setError(t('playground.workspace.gestureTooLong'));
      return;
    }
    const previous = gestureRef.current.path.at(-1);
    if (!previous || Math.hypot(previous.x - position.x, previous.y - position.y) > 0.001) {
      gestureRef.current.path.push(position);
      setPreviewPath([...gestureRef.current.path]);
    }
  };
  const onPointerUp = (event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (dragRef.current) {
      const drag = dragRef.current;
      dragRef.current = null;
      const position = svgToWorld(event) ?? drag.current;
      setDraftPoint(null);
      if (position && Math.hypot(position.x - drag.start.x, position.y - drag.start.y) > 0.001) {
        dispatchTransaction({
          id: nextGestureId('move'),
          actor: 'human',
          intent: 'move',
          operations: [{
            type: 'SET_FEATURE_VALUES',
            feature: xFeature,
            values: [{ pointId: drag.id, value: position.x }],
          }, ...(viewMode === 'scatter' ? [{
            type: 'SET_FEATURE_VALUES',
            feature: yFeature,
            values: [{ pointId: drag.id, value: position.y }],
          }] : [])],
        });
      }
      return;
    }
    finishGesture(event);
  };
  const cancelPointer = () => {
    gestureRef.current = null;
    dragRef.current = null;
    setPreviewPath([]);
    setDraftPoint(null);
  };
  const preciseSubmit = (event) => {
    event.preventDefault();
    const x = Number(preciseX);
    const y = Number(preciseY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setError(t('playground.workspace.invalidCoordinates'));
      return;
    }
    try {
      if (selectedId) {
        dispatchTransaction({
          id: nextGestureId('precise-move'), actor: 'human', intent: 'move',
          operations: [{ type: 'SET_FEATURE_VALUES', feature: xFeature, values: [{ pointId: selectedId, value: x }] }, ...(viewMode === 'scatter'
            ? [{ type: 'SET_FEATURE_VALUES', feature: yFeature, values: [{ pointId: selectedId, value: y }] }]
            : [])],
        });
      } else {
        const point = observationFromProjection(world, {
          xFeature,
          yFeature,
          x,
          y,
          membership: layer,
          provenance: 'manual',
        });
        if (!point) {
          setError(creationUnavailableMessage);
          return;
        }
        dispatchTransaction({
          id: nextGestureId('precise-point'), actor: 'human', intent: 'point',
          operations: [{ type: 'ADD_POINTS', points: [point] }],
        });
      }
    } catch (nextError) {
      setError(nextError);
    }
  };
  const fitView = () => onDispatch({
    type: 'SET_WORKSPACE_VIEW',
    patch: { bounds: projectedBounds(points, xFeature, yFeature), autoFitRevision: (snapshot.viewState?.autoFitRevision ?? 0) + 1 },
  });
  const selectFeatureView = (nextX, nextY, nextMode = viewMode) => {
    setViewMode(nextMode);
    if (nextX) setXFeature(nextX);
    if (nextY) setYFeature(nextY);
    onDispatch({ type: 'SET_WORKSPACE_VIEW', patch: { mode: nextMode, xFeature: nextX ?? xFeature, yFeature: nextY ?? yFeature } });
  };
  const scopeIds = interventionScope === 'selected'
    ? (selectedId ? [selectedId] : [])
    : points.filter((point) => interventionScope === 'all' || visibleMembership(point) === interventionScope).map((point) => point.id);
  const applyIntervention = () => {
    if (!scopeIds.length) return;
    dispatchTransaction({
      id: nextGestureId('intervention'), actor: 'human', intent: 'feature-intervention',
      operations: [{ type: 'TRANSFORM_FEATURE_VALUES', feature: interventionFeature, kind: interventionKind, amount: Number(interventionAmount), seed: Number(interventionSeed), scope: interventionScope, pointIds: scopeIds }],
    });
  };
  const visibility = snapshot.viewState?.visibility ?? 'both';
  const pathPreview = previewPath;

  return <section className="rounded-2xl border border-slate-200 bg-white p-3" aria-label={t('playground.workspace.ariaLabel')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-black text-slate-900">{t('playground.workspace.title')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('playground.workspace.instructions')}</p>
      </div>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <span>{t('playground.workspace.trainCount', { count: counts.train })}</span>
        <span>{t('playground.workspace.testCount', { count: counts.test })}</span>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={viewMode === 'scatter'} onClick={() => selectFeatureView(xFeature, yFeature, 'scatter')} className={`rounded-xl px-3 py-2 text-xs font-bold ${viewMode === 'scatter' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('playground.workspace.scatterView')}</button>
      <button type="button" aria-pressed={viewMode === 'distribution'} onClick={() => selectFeatureView(xFeature, null, 'distribution')} className={`rounded-xl px-3 py-2 text-xs font-bold ${viewMode === 'distribution' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('playground.workspace.distributionView')}</button>
      <label className="text-xs font-bold text-slate-500">{t('playground.workspace.xFeature')}<select value={xFeature} onChange={(event) => selectFeatureView(event.target.value, yFeature)} className="ml-1 rounded-lg border p-1"><option value="">{t('playground.workspace.chooseFeature')}</option>{featureNames.map((feature) => <option key={feature}>{feature}</option>)}</select></label>
      {viewMode === 'scatter' && <label className="text-xs font-bold text-slate-500">{t('playground.workspace.yFeature')}<select value={yFeature} onChange={(event) => selectFeatureView(xFeature, event.target.value)} className="ml-1 rounded-lg border p-1">{featureNames.map((feature) => <option key={feature}>{feature}</option>)}</select></label>}
      {TOOLS.map((item) => {
        const disabled = ['point', 'brush', 'spray'].includes(item) && !canCreateObservation;
        return <button key={item} type="button" disabled={disabled} aria-pressed={tool === item}
          aria-label={t(`playground.workspace.tool.${item}`)} onClick={() => setTool(item)}
          className={`rounded-xl px-3 py-2 text-xs font-bold ${tool === item ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'} disabled:cursor-not-allowed disabled:opacity-40`}>
        {t(`playground.workspace.tool.${item}`)}
        </button>;
      })}
      {!canCreateObservation && <span className="text-xs font-bold text-amber-700">{creationUnavailableMessage}</span>}
      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />
      <span className="text-xs font-bold text-slate-500">{t('playground.workspace.layer')}</span>
      {['train', 'test'].map((item) => <button key={item} type="button" aria-pressed={layer === item}
        onClick={() => setLayer(item)} className={`rounded-xl px-3 py-2 text-xs font-bold ${layer === item ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
        {t(`playground.workspace.layer.${item}`)}
      </button>)}
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        {viewMode === 'distribution' ? <DistributionView points={visiblePoints} feature={xFeature} t={t} /> : <svg ref={svgRef} viewBox="0 0 640 360" className="block h-auto w-full touch-none select-none" role="img"
          aria-label={t('playground.workspace.canvasAria')} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={cancelPointer}>
          <rect x={PLOT.left} y={PLOT.top} width={PLOT.right - PLOT.left} height={PLOT.bottom - PLOT.top} fill="white" />
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={`grid-${ratio}`}>
            <line x1={PLOT.left} y1={PLOT.top + ratio * (PLOT.bottom - PLOT.top)} x2={PLOT.right} y2={PLOT.top + ratio * (PLOT.bottom - PLOT.top)} stroke="#e2e8f0" />
            <line x1={PLOT.left + ratio * (PLOT.right - PLOT.left)} y1={PLOT.top} x2={PLOT.left + ratio * (PLOT.right - PLOT.left)} y2={PLOT.bottom} stroke="#e2e8f0" />
          </g>)}
          <path d={`M${PLOT.left} ${PLOT.top} V${PLOT.bottom} H${PLOT.right}`} fill="none" stroke="#475569" strokeWidth="2" />
          {visiblePoints.map((point) => {
            const selected = selectedId === point.id;
            const draft = draftPoint?.id === point.id ? draftPoint : point;
            const cx = xToSvg(getProjectedValue(draft, xFeature));
            const cy = yToSvg(getProjectedValue(draft, yFeature));
            return visibleMembership(point) === 'test'
              ? <rect key={point.id} x={cx - 5} y={cy - 5} width="10" height="10" transform={`rotate(45 ${cx} ${cy})`} fill="white" stroke={selected ? '#f59e0b' : '#7c3aed'} strokeWidth={selected ? 3 : 2} />
              : <circle key={point.id} cx={cx} cy={cy} r={selected ? 7 : 5} fill="#16a34a" stroke={selected ? '#f59e0b' : 'white'} strokeWidth={selected ? 3 : 1.5} />;
          })}
          {pathPreview.length > 1 && <polyline points={pathPreview.map((point) => `${xToSvg(point.x)},${yToSvg(point.y)}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4" opacity="0.65" />}
          <text x="331" y="350" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{xFeature}</text>
          <text x="14" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 14 170)">{yFeature}</text>
        </svg>}
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
          <div className="flex items-center justify-between gap-2"><span className="font-bold">{t('playground.workspace.visibility')}</span><select value={visibility} onChange={(event) => onDispatch({ type: 'SET_WORKSPACE_VIEW', patch: { visibility: event.target.value } })} className="rounded-lg border bg-white p-1.5 font-bold"><option value="both">{t('playground.workspace.visibility.both')}</option><option value="train">{t('playground.workspace.visibility.train')}</option><option value="test">{t('playground.workspace.visibility.test')}</option></select></div>
          <div className="mt-2 flex flex-wrap gap-2"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-600" />{t('playground.workspace.layer.train')}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rotate-45 border-2 border-violet-600" />{t('playground.workspace.layer.test')}</span></div>
        </div>
        {(tool === 'brush' || tool === 'spray') && <div className="rounded-xl border border-slate-200 p-3 text-xs font-bold text-slate-700">
          <label className="block">{t('playground.workspace.spread')}<input aria-label={t('playground.workspace.spread')} type="range" min="0.02" max="0.6" step="0.01" value={spread} onChange={(event) => setSpread(Number(event.target.value))} className="mt-2 w-full accent-blue-600" /></label>
          <label className="mt-3 block">{t('playground.workspace.density')}<input aria-label={t('playground.workspace.density')} type="range" min="1" max="20" step="1" value={density} onChange={(event) => setDensity(Number(event.target.value))} className="mt-2 w-full accent-blue-600" /></label>
        </div>}
        <div className="rounded-xl border border-slate-200 p-3 text-xs font-bold text-slate-700">
          <p>{t('playground.workspace.intervention')}</p>
          <select value={interventionFeature} onChange={(event) => setInterventionFeature(event.target.value)} className="mt-2 w-full rounded-lg border p-2">{featureNames.map((feature) => <option key={feature}>{feature}</option>)}</select>
          <select value={interventionKind} onChange={(event) => setInterventionKind(event.target.value)} className="mt-2 w-full rounded-lg border p-2"><option value="shift">{t('playground.workspace.shift')}</option><option value="scale">{t('playground.workspace.scale')}</option><option value="noise">{t('playground.workspace.addNoise')}</option></select>
          <select value={interventionScope} onChange={(event) => setInterventionScope(event.target.value)} className="mt-2 w-full rounded-lg border p-2"><option value="all">{t('playground.workspace.scope.all')}</option><option value="train">{t('playground.workspace.scope.train')}</option><option value="test">{t('playground.workspace.scope.test')}</option><option value="selected" disabled={!selectedId}>{t('playground.workspace.scope.selected')}</option></select>
          <input aria-label={t('playground.workspace.amount')} type="number" step="0.1" value={interventionAmount} onChange={(event) => setInterventionAmount(event.target.value)} className="mt-2 w-full rounded-lg border p-2" />
          {interventionKind === 'noise' && <input aria-label={t('playground.workspace.seed')} type="number" value={interventionSeed} onChange={(event) => setInterventionSeed(event.target.value)} className="mt-2 w-full rounded-lg border p-2" />}
          <button type="button" disabled={!scopeIds.length} onClick={applyIntervention} className="mt-2 w-full rounded-lg bg-amber-500 px-3 py-2 text-white disabled:opacity-40">{t('playground.workspace.apply')}</button>
        </div>
        <form onSubmit={preciseSubmit} className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-700">{selectedId ? t('playground.workspace.editPoint') : t('playground.workspace.precisePoint')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2"><input inputMode="decimal" aria-label={t('playground.workspace.xCoordinate')} value={preciseX} onChange={(event) => setPreciseX(event.target.value)} placeholder={t('playground.workspace.xShort')} className="w-full rounded-lg border p-2 text-sm" /><input inputMode="decimal" aria-label={t('playground.workspace.yCoordinate')} value={preciseY} onChange={(event) => setPreciseY(event.target.value)} placeholder={t('playground.workspace.yShort')} className="w-full rounded-lg border p-2 text-sm" /></div>
          <button type="submit" disabled={!selectedId && !canCreateObservation} className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{selectedId ? t('playground.workspace.updatePoint') : t('playground.workspace.addPoint')}</button>
        </form>
        <div className="flex gap-2"><button type="button" disabled={!snapshot.capabilities?.canUndoWorld} onClick={() => onDispatch({ type: 'UNDO_WORLD_ACTION' })} className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{t('playground.workspace.undo')}</button><button type="button" disabled={!snapshot.capabilities?.canRedoWorld} onClick={() => onDispatch({ type: 'REDO_WORLD_ACTION' })} className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{t('playground.workspace.redo')}</button></div>
        <button type="button" onClick={fitView} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.workspace.fitView')}</button>
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800">{typeof error === 'string' ? error : t('playground.workspace.actionFailed')}</p>}
      </div>
    </div>
  </section>;
}
