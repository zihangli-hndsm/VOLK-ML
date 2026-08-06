import { PlaygroundStageView } from './viewRegistry.jsx';

export default function PlaygroundStage({ playgroundId, snapshot, t, onAddPoint, onMovePoint, onRemovePoint }) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <PlaygroundStageView
      playgroundId={playgroundId}
      snapshot={snapshot}
      t={t}
      onAddPoint={onAddPoint}
      onMovePoint={onMovePoint}
      onRemovePoint={onRemovePoint}
    />
  </div>;
}
