import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { createPlaygroundSession, derivePlaygroundSnapshot } from '../src/core/playgrounds/session.js';
import { fallbackRegressionPoints } from '../src/core/linearRegressionPlayground.js';
import ExploreShell from '../src/components/playground/ExploreShell.jsx';
import ExploreContextBar from '../src/components/playground/ExploreContextBar.jsx';
import ExploreWorldRegion from '../src/components/playground/ExploreWorldRegion.jsx';
import ExploreExperimentRegion from '../src/components/playground/ExploreExperimentRegion.jsx';
import ExploreDetailsRegion from '../src/components/playground/ExploreDetailsRegion.jsx';

const t = (key) => key;
const noop = () => {};

export function runUiExploreShellSmoke() {
  const playground = getPlayground('linear-regression');
  const source = {
    kind: 'example',
    name: 'Example',
    fingerprint: 'ui1-shell',
    points: fallbackRegressionPoints.map((point, index) => ({ id: `e${index}`, x: point.x, y: point.y })),
    feature: 'x',
    target: 'y',
  };
  const snapshot = derivePlaygroundSnapshot(createPlaygroundSession(playground, { source, seed: 7, sessionId: 'ui1-shell' }));
  const context = renderToStaticMarkup(<ExploreContextBar playground={playground} snapshot={snapshot} onDispatch={noop} onPresent={noop} onClose={noop} t={t} />);
  const world = renderToStaticMarkup(<ExploreWorldRegion snapshot={snapshot} activeTab="model" onTabChange={noop} onDispatch={noop} onOpenDepth={noop} t={t} />);
  const experiment = renderToStaticMarkup(<ExploreExperimentRegion t={t}><span>experiment</span></ExploreExperimentRegion>);
  const details = renderToStaticMarkup(<ExploreDetailsRegion snapshot={snapshot} modelPlayground={playground} bigIdea={null} agent={null} host={null} activeDepth={null} onDepthChange={noop} onDispatch={noop} onGuidanceChange={noop} formulaPrimitive={snapshot.primitives.find((primitive) => primitive.type === 'formula')} t={t} />);
  const shell = renderToStaticMarkup(<ExploreShell contextBar={<div dangerouslySetInnerHTML={{ __html: context }} />} worldRegion={<div dangerouslySetInnerHTML={{ __html: world }} />} experimentRegion={<div dangerouslySetInnerHTML={{ __html: experiment }} />} detailsRegion={<div dangerouslySetInnerHTML={{ __html: details }} />} />);

  assert.ok(shell.includes('data-ui-region="context-bar"'), 'Context Bar renders');
  assert.ok(shell.includes('data-ui-region="world-region"'), 'World region renders');
  assert.ok(shell.includes('data-ui-region="experiment-region"'), 'Experiment region renders');
  assert.ok(shell.includes('data-ui-region="details-region"'), 'Details region renders');
  assert.ok(shell.indexOf('data-ui-region="context-bar"') < shell.indexOf('data-ui-region="world-region"'), 'Context precedes World');
  assert.ok(shell.indexOf('data-ui-region="world-region"') < shell.indexOf('data-ui-region="experiment-region"'), 'World precedes Experiment');
  assert.ok(shell.indexOf('data-ui-region="experiment-region"') < shell.indexOf('data-ui-region="details-region"'), 'Experiment precedes Details');
  assert.ok(context.includes('playground.lifecycle.run'), 'Run remains a visible semantic action');
  assert.ok(context.includes('playground.explore.more'), 'Low-frequency actions use the overflow entry');
  assert.ok(details.includes('playground.depth.inspectModel'), 'Inspect-model depth is reachable');
  assert.ok(details.includes('playground.depth.whatChanged'), 'Evidence depth entrance renders');
  assert.equal(details.includes('role="dialog"'), false, 'No depth panel opens by default');
  assert.equal(details.includes('playground.explorationAgent.title'), false, 'Agent-disabled mode does not render Agent UI');

  return { passed: true, runtimeIdentity: snapshot.experimentWorkspace.activeExperimentId };
}
