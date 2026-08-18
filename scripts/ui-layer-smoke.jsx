import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { CONCEPTUAL_DEPTHS } from '../src/core/ui/uiArchitecture.js';
import { openFullWorldWorkspacePresentation } from '../src/core/ui/layerNavigation.js';
import ExploreDetailsRegion from '../src/components/playground/ExploreDetailsRegion.jsx';
import ExploreWorldRegion from '../src/components/playground/ExploreWorldRegion.jsx';
import { PresentationCapabilitiesProvider } from '../src/components/playground/usePresentationCapabilities.jsx';
import { AiProvider } from '../src/components/ai/AiProviderContext.jsx';
import { resolveMessage } from '../src/i18n.js';

const t = (key, params) => resolveMessage(key, 'en', params);
const noop = () => {};

function provider(width) {
  return <PresentationCapabilitiesProvider value={{
    rawCapabilities: { containerWidth: width, containerHeight: width < 640 ? 844 : 768, pointer: width < 640 ? 'coarse' : 'fine', hover: width < 640 ? 'none' : 'available' },
    responsive: { band: width < 640 ? 'compact' : width < 1024 ? 'medium' : 'wide', containerWidth: width, pointer: width < 640 ? 'coarse' : 'fine', hover: width < 640 ? 'none' : 'available', orientation: width < 640 ? 'portrait' : 'landscape', inspectorPresentation: width < 640 ? 'bottom-sheet' : 'drawer-or-sidebar', comparePresentation: width >= 1024 ? 'side-by-side' : 'overlay-or-swipe' },
  }} />;
}

function renderTune(snapshot, width) {
  return renderToStaticMarkup(<AiProvider><PresentationCapabilitiesProvider value={{
    rawCapabilities: { containerWidth: width },
    responsive: { band: width < 640 ? 'compact' : 'wide', containerWidth: width, pointer: 'unknown', hover: 'unknown', orientation: width < 640 ? 'portrait' : 'landscape', inspectorPresentation: width < 640 ? 'bottom-sheet' : 'drawer-or-sidebar', comparePresentation: width < 1024 ? 'overlay-or-swipe' : 'side-by-side' },
  }}><ExploreDetailsRegion snapshot={snapshot} modelPlayground={getPlayground('linear-regression')} bigIdea={null} agent={null} host={null} activeDepth={CONCEPTUAL_DEPTHS.TUNE} onDepthChange={noop} onAgentOpen={noop} onAgentClose={noop} agentOpen={false} onDispatch={noop} onGuidanceChange={noop} formulaPrimitive={snapshot.primitives.find((primitive) => primitive.type === 'formula')} onOpenWorldTools={noop} t={t} /></PresentationCapabilitiesProvider></AiProvider>);
}

export async function runUiLayerSmoke() {
  const host = createPlaygroundHost({ getDataset: () => null });
  await host.open({ playgroundId: 'linear-regression', seed: 912 });
  const snapshot = host.getState();
  const runtimeIdentity = { world: snapshot.world, experiment: snapshot.experimentWorkspace, model: snapshot.model };
  const initial = { activeDepth: CONCEPTUAL_DEPTHS.TUNE, activeTab: 'model', fullWorldToolsOpen: false };
  const tuneDesktop = renderTune(snapshot, 1366);
  assert.ok(tuneDesktop.includes('More world tools'), 'Tune exposes the existing full World entry');
  assert.ok(tuneDesktop.includes('role="dialog"'), 'Tune opens as one secondary surface');
  const tuneCompact = renderTune(snapshot, 390);
  assert.ok(tuneCompact.includes('bottom-0'), 'Compact Tune uses the bottom-sheet presentation');

  const next = openFullWorldWorkspacePresentation(initial);
  assert.deepEqual(next, { activeDepth: null, activeTab: 'data', fullWorldToolsOpen: true }, 'Tune navigation closes depth, selects Data, and opens full World tools atomically');
  assert.deepEqual({ world: snapshot.world, experiment: snapshot.experimentWorkspace, model: snapshot.model }, runtimeIdentity, 'presentation navigation does not change runtime identity');

  const fullWorld = renderToStaticMarkup(<ExploreWorldRegion snapshot={snapshot} bigIdea={null} activeTab={next.activeTab} onTabChange={noop} onDispatch={noop} t={t} fullWorldToolsOpen={next.fullWorldToolsOpen} onFullWorldToolsChange={noop} onOpenFullWorldTools={noop} />);
  assert.ok(fullWorld.includes('role="tab" aria-selected="true"'), 'full World workspace is visible after the transition');
  assert.ok(fullWorld.includes('role="tab" aria-selected="false"'), 'Model tab is not selected after the transition');
  assert.ok(fullWorld.includes('Full World tools'), 'full World destination is rendered');
  await host.close();
  return { passed: true, compactSheetClosed: next.activeDepth === null, dataTabSelected: next.activeTab === 'data' };
}
