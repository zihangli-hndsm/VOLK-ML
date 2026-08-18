// Presentation-only transitions for the layered Explore shell. These helpers
// return view state; they never dispatch or copy World/Experiment state.
export function openFullWorldWorkspacePresentation(state = {}) {
  return {
    ...state,
    fullWorldToolsOpen: true,
    activeTab: 'data',
    activeDepth: null,
  };
}
