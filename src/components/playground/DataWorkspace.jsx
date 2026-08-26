import { useEffect, useMemo, useRef, useState } from 'react';
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
import { usePresentationCapabilities } from './usePresentationCapabilities.jsx';
import {
  axisTicks,
  clientToLocalPoint,
  clientToSvgPoint,
  formatAxisTick,
  nearestPointInLocal,
  selectScatterBounds,
  zoomScatterBounds,
} from './dataWorkspaceGeometry.js';
import { getVisiblePrimitives, resolveMotionConfig } from './motion.js';
import { usePrimitiveMotion, useReducedMotionPreference } from './usePrimitiveMotion.js';
import { rendererByPrimitiveType } from './rendererRegistry.jsx';
import { buildLabelColorMap } from './visualEncoding.js';

const PLOT = { left: 42, right: 620, top: 18, bottom: 320 };
const PHENOMENON_PLOT = { left: 58, right: 620, top: 20, bottom: 320 };
const TOOLS = ['point', 'brush', 'spray', 'select', 'erase'];
const PHENOMENON_TOOLS = ['select', 'point', 'erase'];
const PHENOMENON_PRIMITIVES = new Set(['scatter', 'regression-line', 'reference-line', 'residual-lines', 'decision-region', 'neighbor-links', 'query-point', 'vote-bars']);

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

export default function DataWorkspace({ snapshot, onDispatch, t, highlightedAffordances = [], variant = 'full', question, onOpenFullWorkspace }) {
  const phenomenonMode = variant === 'phenomenon';
  const plot = phenomenonMode ? PHENOMENON_PLOT : PLOT;
  const { responsive } = usePresentationCapabilities();
  const touchInput = responsive.pointer === 'coarse' || responsive.band === 'compact';
  const svgRef = useRef(null);
  const gestureRef = useRef(null);
  const dragRef = useRef(null);
  const counterRef = useRef(0);
  const [tool, setTool] = useState(phenomenonMode ? 'select' : 'point');
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
  const canSampleAgain = world?.mode === 'generated' && operations.has('RESAMPLE_WORLD');
  const sampleEventCount = (snapshot.semanticEvents?.events ?? []).filter((event) => event?.type === 'observation.sampled').length;
  const againstExperimentId = snapshot.experimentWorkspace?.comparison?.againstExperimentId ?? null;
  const canCompareSamples = Boolean(againstExperimentId);
  const canEdit = Boolean(snapshot.capabilities?.canEditWorld)
    && operations.has('ADD_POINTS')
    && operations.has('MOVE_POINT')
    && operations.has('REMOVE_POINT')
    && operations.has('REMOVE_POINTS')
    && operations.has('SET_TRAIN_TEST_MEMBERSHIP');
  const points = world?.observations ?? [];
  const featureNames = world?.featureNames ?? ['x', 'y'];
  useEffect(() => {
    const nextX = snapshot.viewState?.xFeature ?? featureNames[0] ?? 'x';
    const nextY = snapshot.viewState?.yFeature ?? featureNames[1] ?? nextX;
    setViewMode(snapshot.viewState?.mode ?? 'scatter');
    setXFeature(nextX);
    setYFeature(nextY);
    setInterventionFeature((current) => featureNames.includes(current) ? current : nextX);
  }, [snapshot.viewState?.mode, snapshot.viewState?.xFeature, snapshot.viewState?.yFeature, featureNames.join('\u0000')]);
  const projectedPoints = points.map((point) => projectObservation(point, xFeature, yFeature))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const projectedViewBounds = projectedBounds(points, xFeature, yFeature);
  const comparisonBounds = snapshot.experimentWorkspace?.comparison?.enabled
    && snapshot.experimentWorkspace.comparison.bounds;
  const phenomenonPrimitives = useMemo(
    () => getVisiblePrimitives(snapshot, 'stage').filter((primitive) => PHENOMENON_PRIMITIVES.has(primitive.type)),
    [snapshot],
  );
  const reducedMotion = useReducedMotionPreference();
  const phenomenonMotionTargets = useMemo(
    () => phenomenonPrimitives.filter((primitive) => primitive.type !== 'scatter'),
    [phenomenonPrimitives],
  );
  const phenomenonMotion = usePrimitiveMotion(phenomenonMotionTargets, resolveMotionConfig(snapshot, reducedMotion, { token: 'normal' }));
  const animatedPhenomenonById = new Map(phenomenonMotion.primitives.map((primitive) => [primitive.id, primitive]));
  const renderedPhenomenonPrimitives = phenomenonPrimitives.map((primitive) => (
    primitive.type === 'scatter' ? primitive : animatedPhenomenonById.get(primitive.id) ?? primitive
  ));
  const phenomenonScatter = phenomenonPrimitives.find((primitive) => primitive.type === 'scatter');
  const phenomenonPoints = phenomenonScatter?.props?.points ?? [];
  const phenomenonColorByLabel = buildLabelColorMap(phenomenonPoints);
  const phenomenonRanges = useMemo(() => {
    const xs = phenomenonPoints.map((point) => point.x).filter(Number.isFinite);
    const ys = phenomenonPoints.map((point) => point.y).filter(Number.isFinite);
    const xSpan = Math.max(0.5, xs.length ? Math.max(...xs) - Math.min(...xs) : 1);
    const ySpan = Math.max(0.5, ys.length ? Math.max(...ys) - Math.min(...ys) : 1);
    return {
      xMin: xs.length ? Math.min(...xs) - xSpan * 0.1 : -1,
      xMax: xs.length ? Math.max(...xs) + xSpan * 0.1 : 1,
      yMin: ys.length ? Math.min(...ys) - ySpan * 0.1 : -1,
      yMax: ys.length ? Math.max(...ys) + ySpan * 0.1 : 1,
    };
  }, [phenomenonPoints]);
  const effectiveViewMode = phenomenonMode ? 'scatter' : viewMode;
  const bounds = effectiveViewMode === 'scatter'
    ? selectScatterBounds({
      comparisonBounds,
      xFeature,
      yFeature,
      autoBounds: phenomenonMode ? phenomenonRanges : projectedViewBounds,
      manualBounds: snapshot.viewState?.bounds,
      boundsMode: snapshot.viewState?.boundsMode,
      equalScale: snapshot.viewState?.equalScale,
      plot,
    })
    : baseBounds;
  const xAxisTicks = axisTicks(bounds.xMin, bounds.xMax);
  const yAxisTicks = axisTicks(bounds.yMin, bounds.yMax);
  const xTickStep = Math.abs((xAxisTicks[1]?.value ?? bounds.xMax) - (xAxisTicks[0]?.value ?? bounds.xMin));
  const yTickStep = Math.abs((yAxisTicks[1]?.value ?? bounds.yMax) - (yAxisTicks[0]?.value ?? bounds.yMin));
  const canCreateObservation = Boolean(snapshot.capabilities?.canCreateObservationFromProjection);
  const highlight = (id) => highlightedAffordances.includes(id) ? ' ring-2 ring-amber-400 ring-offset-1' : '';
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

  const xToSvg = (x) => plot.left + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * (plot.right - plot.left);
  const yToSvg = (y) => plot.bottom - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin)) * (plot.bottom - plot.top);
  const hitRadiusPx = touchInput ? 22 : 10;
  const svgToWorld = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const pixel = clientToSvgPoint({ clientX: event.clientX, clientY: event.clientY, rect });
    if (!pixel) return null;
    const { x, y } = pixel;
    return {
      x: bounds.xMin + ((x - plot.left) / (plot.right - plot.left)) * (bounds.xMax - bounds.xMin),
      y: bounds.yMax - ((y - plot.top) / (plot.bottom - plot.top)) * (bounds.yMax - bounds.yMin),
    };
  };
  const svgToPixel = (event) => clientToLocalPoint({
    clientX: event.clientX,
    clientY: event.clientY,
    rect: svgRef.current?.getBoundingClientRect(),
  });
  const nearestPoint = (position) => nearestPointInLocal({ points: visiblePoints, position, xFeature, yFeature, bounds, rect: svgRef.current?.getBoundingClientRect() });
  const dispatchTransaction = (transaction) => {
    setError(null);
    Promise.resolve(onDispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction })).catch((nextError) => setError(nextError));
  };
  const nextGestureId = (name) => `workspace-${name}-${counterRef.current++}`;
  const finishGesture = (event) => {
    const position = svgToWorld(event);
    const pixelPosition = svgToPixel(event);
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
        const pixelPath = [...gesture.pixelPath, ...(pixelPosition ? [pixelPosition] : [])];
        const ids = new Set(points.filter((point) => pixelPath.some((sample) => {
          const projected = nearestPointInLocal({ points: [point], position: sample, xFeature, yFeature, bounds, rect: svgRef.current?.getBoundingClientRect() });
          return projected && projected.distancePx <= hitRadiusPx;
        })).map((point) => point.id));
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
      const hit = nearestPoint(svgToPixel(event));
      if (!hit || hit.distancePx > hitRadiusPx) {
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
      pixelPath: svgToPixel(event) ? [svgToPixel(event)] : [],
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
      const pixelPosition = svgToPixel(event);
      if (pixelPosition) gestureRef.current.pixelPath.push(pixelPosition);
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
          }, ...(effectiveViewMode === 'scatter' ? [{
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
          operations: [{ type: 'SET_FEATURE_VALUES', feature: xFeature, values: [{ pointId: selectedId, value: x }] }, ...(effectiveViewMode === 'scatter'
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
    patch: { bounds: projectedBounds(points, xFeature, yFeature), boundsMode: 'auto', autoFitRevision: (snapshot.viewState?.autoFitRevision ?? 0) + 1 },
  });
  const zoomView = (factor) => onDispatch({
    type: 'SET_WORKSPACE_VIEW',
    patch: { bounds: zoomScatterBounds(bounds, factor), boundsMode: 'manual' },
  });
  const toggleEqualScale = () => onDispatch({
    type: 'SET_WORKSPACE_VIEW',
    patch: { equalScale: !snapshot.viewState?.equalScale },
  });
  const selectFeatureView = (nextX, nextY, nextMode = viewMode) => {
    setViewMode(nextMode);
    if (nextX) setXFeature(nextX);
    if (nextY) setYFeature(nextY);
    onDispatch({ type: 'SET_WORKSPACE_VIEW', patch: { mode: nextMode, xFeature: nextX ?? xFeature, yFeature: nextY ?? yFeature, boundsMode: 'auto' } });
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
  const compareSamples = () => {
    if (!canCompareSamples) return;
    Promise.resolve(onDispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId })).catch((nextError) => setError(nextError));
  };
  const sampleAgain = () => {
    Promise.resolve(onDispatch({ type: 'DUPLICATE_EXPERIMENT' }))
      .then(() => onDispatch({ type: 'RESAMPLE_WORLD' }))
      .catch((nextError) => setError(nextError));
  };
  const visibility = snapshot.viewState?.visibility ?? 'both';
  const pathPreview = previewPath;

  return <section data-phenomenon-surface={phenomenonMode ? 'true' : undefined} className={`min-w-0 ${phenomenonMode ? 'rounded-2xl bg-white' : 'rounded-2xl border border-slate-200 bg-white p-3'}`} aria-label={t(phenomenonMode ? 'playground.phenomenon.ariaLabel' : 'playground.workspace.ariaLabel')}>
    {phenomenonMode ? <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xl font-black leading-7 text-slate-950">{question ?? t('playground.phenomenon.question')}</p>
        <p className="mt-1 text-xs font-bold text-slate-500">{t('playground.phenomenon.hint')}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label={t('playground.phenomenon.toolsLabel')}>
        {canSampleAgain && <button data-affordance-id="world.sampleAgain" type="button" onClick={sampleAgain} className="min-h-10 rounded-xl bg-cyan-700 px-3 py-2 text-sm font-black text-white hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('playground.phenomenon.sampleAgain')}</button>}
        {PHENOMENON_TOOLS.map((item) => <button data-phenomenon-tool={item === 'select' ? 'move' : item === 'point' ? 'draw' : item} key={item} type="button" aria-pressed={tool === item}
          aria-label={t(`playground.workspace.tool.${item === 'select' ? 'move' : item === 'point' ? 'draw' : item}`)} onClick={() => setTool(item)}
          className={`min-h-10 rounded-xl px-3 py-2 text-sm font-black ${tool === item ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
        {t(`playground.workspace.tool.${item === 'select' ? 'move' : item === 'point' ? 'draw' : item}`)}
        </button>)}
      </div>
    </div> : <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-black text-slate-900">{t('playground.workspace.title')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('playground.workspace.instructions')}</p>
      </div>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <span>{t('playground.workspace.trainCount', { count: counts.train })}</span>
        <span>{t('playground.workspace.testCount', { count: counts.test })}</span>
      </div>
    </div>}
    {!phenomenonMode && <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={viewMode === 'scatter'} onClick={() => selectFeatureView(xFeature, yFeature, 'scatter')} className={`rounded-xl px-3 py-2 text-xs font-bold ${viewMode === 'scatter' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('playground.workspace.scatterView')}</button>
      <button type="button" aria-pressed={viewMode === 'distribution'} onClick={() => selectFeatureView(xFeature, null, 'distribution')} className={`rounded-xl px-3 py-2 text-xs font-bold ${viewMode === 'distribution' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('playground.workspace.distributionView')}</button>
      <label className="text-xs font-bold text-slate-500">{t('playground.workspace.xFeature')}<select value={xFeature} onChange={(event) => selectFeatureView(event.target.value, yFeature)} className="ml-1 rounded-lg border p-1"><option value="">{t('playground.workspace.chooseFeature')}</option>{featureNames.map((feature) => <option key={feature}>{feature}</option>)}</select></label>
      {viewMode === 'scatter' && <label className="text-xs font-bold text-slate-500">{t('playground.workspace.yFeature')}<select value={yFeature} onChange={(event) => selectFeatureView(xFeature, event.target.value)} className="ml-1 rounded-lg border p-1">{featureNames.map((feature) => <option key={feature}>{feature}</option>)}</select></label>}
      {TOOLS.map((item) => {
        const disabled = ['point', 'brush', 'spray'].includes(item) && !canCreateObservation;
        return <button data-affordance-id={item === 'point' || item === 'spray' ? 'world.outlier' : undefined} key={item} type="button" disabled={disabled} aria-pressed={tool === item}
          aria-label={t(`playground.workspace.tool.${item}`)} onClick={() => setTool(item)}
          className={`ui-motion-interactive rounded-xl px-3 py-2 text-xs font-bold ${tool === item ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}${item === 'point' || item === 'spray' ? highlight('world.outlier') : ''} disabled:cursor-not-allowed disabled:opacity-40`}>
        {t(`playground.workspace.tool.${item}`)}
        </button>;
      })}
      {!canCreateObservation && <span className="text-xs font-bold text-amber-700">{creationUnavailableMessage}</span>}
      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />
      <span className="text-xs font-bold text-slate-500">{t('playground.workspace.layer')}</span>
      {['train', 'test'].map((item) => <button data-affordance-id="world.trainTestLayer" key={item} type="button" aria-pressed={layer === item}
        onClick={() => setLayer(item)} className={`rounded-xl px-3 py-2 text-xs font-bold ${layer === item ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}${highlight('world.trainTestLayer')}`}>
        {t(`playground.workspace.layer.${item}`)}
      </button>)}
    </div>}
    {phenomenonMode && sampleEventCount > 0 && <section data-sample-status="true" className="rounded-xl border border-cyan-200 bg-cyan-50/70 px-3 py-2">
      <p className="text-xs font-black text-cyan-950">{t('playground.phenomenon.sampleStatus')}</p>
      <p className="mt-1 text-xs text-cyan-900">{t('playground.phenomenon.sampleQuestion')}</p>
      <button type="button" disabled={!canCompareSamples} onClick={compareSamples} className="mt-2 rounded-lg border border-cyan-300 bg-white px-3 py-2 text-xs font-black text-cyan-900 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50">{canCompareSamples ? t('playground.phenomenon.compareSamples') : t('playground.phenomenon.compareSamplesUnavailable')}</button>
    </section>}
    <div className={`mt-3 min-w-0 ${phenomenonMode ? 'space-y-3' : 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]'}`}>
      <div className="ui-motion-surface overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        {effectiveViewMode === 'scatter' && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-2 text-[10px] text-slate-600">
          <span className="font-mono" aria-live="polite">{t('playground.workspace.rangeSummary', { xMin: formatAxisTick(bounds.xMin, xTickStep), xMax: formatAxisTick(bounds.xMax, xTickStep), yMin: formatAxisTick(bounds.yMin, yTickStep), yMax: formatAxisTick(bounds.yMax, yTickStep) })}</span>
          <div className="flex flex-wrap items-center gap-1" aria-label={t('playground.workspace.scaleControls')}>
            <button type="button" onClick={() => zoomView(0.8)} aria-label={t('playground.workspace.zoomIn')} title={t('playground.workspace.zoomIn')} className="min-h-8 rounded-lg border border-slate-300 bg-white px-2 font-black text-slate-700">+</button>
            <button type="button" onClick={() => zoomView(1.25)} aria-label={t('playground.workspace.zoomOut')} title={t('playground.workspace.zoomOut')} className="min-h-8 rounded-lg border border-slate-300 bg-white px-2 font-black text-slate-700">−</button>
            <button type="button" onClick={fitView} className="min-h-8 rounded-lg border border-slate-300 bg-white px-2 font-black text-slate-700">{t('playground.workspace.fitView')}</button>
            <button type="button" aria-pressed={Boolean(snapshot.viewState?.equalScale)} onClick={toggleEqualScale} className={`min-h-8 rounded-lg border px-2 font-black ${snapshot.viewState?.equalScale ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{t('playground.workspace.equalScale')}</button>
          </div>
        </div>}
        {!phenomenonMode && viewMode === 'distribution' ? <DistributionView points={visiblePoints} feature={xFeature} t={t} /> : <svg ref={svgRef} viewBox="0 0 640 360" className="block h-auto w-full touch-none select-none" role="img"
          aria-label={t('playground.workspace.canvasAria')} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={cancelPointer}>
          <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="white" />
          {phenomenonMode && renderedPhenomenonPrimitives.map((primitive) => {
            const Renderer = rendererByPrimitiveType[primitive.type];
            if (!Renderer) return null;
            return <Renderer key={primitive.id} props={primitive.props} variant={primitive.type}
              xToSvg={xToSvg} yToSvg={yToSvg} colorByLabel={phenomenonColorByLabel} plot={plot} t={t} />;
          })}
          {xAxisTicks.map((tick) => <g key={`grid-x-${tick.value}`}>
            <line x1={xToSvg(tick.value)} y1={plot.top} x2={xToSvg(tick.value)} y2={plot.bottom} stroke="#e2e8f0" />
            <text x={xToSvg(tick.value)} y={plot.bottom + 15} textAnchor="middle" fontSize="9" fill="#64748b">{tick.label}</text>
          </g>)}
          {yAxisTicks.map((tick) => <g key={`grid-y-${tick.value}`}>
            <line x1={plot.left} y1={yToSvg(tick.value)} x2={plot.right} y2={yToSvg(tick.value)} stroke="#e2e8f0" />
            <text x={plot.left - 5} y={yToSvg(tick.value) + 3} textAnchor="end" fontSize="9" fill="#64748b">{tick.label}</text>
          </g>)}
          <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} fill="none" stroke="#475569" strokeWidth="2" />
          {!phenomenonMode && visiblePoints.map((point) => {
            const selected = selectedId === point.id;
            const draft = draftPoint?.id === point.id ? draftPoint : point;
            const cx = xToSvg(getProjectedValue(draft, xFeature));
            const cy = yToSvg(getProjectedValue(draft, yFeature));
            return visibleMembership(point) === 'test'
              ? <rect key={point.id} x={cx - 5} y={cy - 5} width="10" height="10" transform={`rotate(45 ${cx} ${cy})`} fill="white" stroke={selected ? '#f59e0b' : '#7c3aed'} strokeWidth={selected ? 3 : 2} />
              : <circle key={point.id} cx={cx} cy={cy} r={selected ? 7 : 5} fill="#16a34a" stroke={selected ? '#f59e0b' : 'white'} strokeWidth={selected ? 3 : 1.5} />;
          })}
          {phenomenonMode && draftPoint && <circle cx={xToSvg(getProjectedValue(draftPoint, xFeature))} cy={yToSvg(getProjectedValue(draftPoint, yFeature))} r="8" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="4 3" />}
          {pathPreview.length > 1 && <polyline points={pathPreview.map((point) => `${xToSvg(point.x)},${yToSvg(point.y)}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4" opacity="0.65" />}
          <text x="331" y="352" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{xFeature}</text>
          <text x="10" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 10 170)">{yFeature}</text>
        </svg>}
      </div>
      {!phenomenonMode && <div className="space-y-3">
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
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800">{typeof error === 'string' ? error : t('playground.workspace.actionFailed')}</p>}
      </div>}
    </div>
    {phenomenonMode && <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-bold text-slate-500">{t('playground.phenomenon.worldHint')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!snapshot.capabilities?.canUndoWorld} onClick={() => onDispatch({ type: 'UNDO_WORLD_ACTION' })} className="ui-motion-interactive rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{t('playground.phenomenon.undo')}</button>
        {onOpenFullWorkspace && <button type="button" onClick={onOpenFullWorkspace} className="ui-motion-interactive rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">{t('playground.phenomenon.moreWorldTools')}</button>}
      </div>
    </div>}
  </section>;
}
