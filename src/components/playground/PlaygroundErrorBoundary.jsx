import React from 'react';

// Captures render exceptions from the Playground subtree (Stage, Inspector,
// Timeline, formula/renderers) so a renderer bug never white-screens the whole
// application. The fallback only depends on onClose/onReset/t/error message —
// never on a possibly-corrupt snapshot.
export default class PlaygroundErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.playgroundId !== this.props.playgroundId && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = async () => {
    try {
      await this.props.onReset?.();
      this.setState({ hasError: false, error: null });
    } catch {
      // Keep the fallback visible if the reset itself fails.
    }
  };

  render() {
    if (this.state.hasError) {
      const { t } = this.props;
      return <div className="m-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="text-lg font-black text-red-700">{t('playground.errorTitle')}</h2>
        <p className="mt-2 text-sm text-red-600">{t('playground.errorBody')}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={this.handleReset} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">{t('playground.errorReset')}</button>
          <button onClick={this.props.onClose} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">{t('playground.errorClose')}</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}
