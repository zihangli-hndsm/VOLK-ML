import { derivePlayQuickControl } from '../../core/ui/playQuickControl.js';
import { deriveTuneControlState } from '../../core/ui/contextualTune.js';
import PlaygroundControlField from './PlaygroundControlField.jsx';

export default function PlayQuickControl({ playground, snapshot, onDispatch, t, intervention = null }) {
  const control = derivePlayQuickControl(playground, snapshot);
  if (!control) return null;
  const comparison = snapshot.experimentWorkspace?.comparison;
  const state = comparison?.enabled
    ? deriveTuneControlState(control, comparison.diff ?? {})
    : { changed: false, held: false };
  const focused = intervention?.target?.type === 'experiment' && intervention.target.id === snapshot.experimentWorkspace?.activeExperimentId;
  return <section data-ui-quick-control="true" data-lumi-target={focused ? `experiment:${intervention.target.id}` : undefined} aria-label={t('playground.quickControl.ariaLabel')} className={`min-w-0 rounded-2xl border border-blue-100 bg-blue-50/60 p-2${focused ? ' lumi-control-focus' : ''}`}>
    <p className="mb-2 px-1 text-xs font-black text-blue-900">{t('playground.quickControl.prompt')}</p>
    <PlaygroundControlField control={control} snapshot={snapshot} onDispatch={onDispatch} t={t} showHint changed={state.changed} held={state.held} compact interventionControlKey={intervention?.controlKey} />
  </section>;
}
