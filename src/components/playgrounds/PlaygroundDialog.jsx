import UnifiedPlaygroundDialog from '../playground/UnifiedPlaygroundDialog.jsx';
import PlaygroundErrorBoundary from '../playground/PlaygroundErrorBoundary.jsx';

// Compatibility entry point: the unified visualization playground host,
// wrapped in an Error Boundary so any renderer failure stays inside the
// Playground and the user can always Reset or Close.
export default function PlaygroundDialog(props) {
  return <PlaygroundErrorBoundary
    key={props.playgroundId}
    playgroundId={props.playgroundId}
    onClose={props.onClose}
    onReset={() => props.host?.reset()}
    t={props.t}
  >
    <UnifiedPlaygroundDialog {...props} />
  </PlaygroundErrorBoundary>;
}
