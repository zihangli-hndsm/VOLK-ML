// Presentation-only focus ownership. Runtime state never depends on focus.
export const PRESENTATION_FOCUS_OWNERS = Object.freeze({
  AGENT: 'agent',
  DEPTH: 'depth',
  AGENT_TRIGGER: 'agent-trigger',
  DEPTH_TRIGGER: 'depth-trigger',
  NONE: 'none',
});

export function resolvePresentationFocusOwner({
  activeDepth = null,
  agentOpen = false,
  previousDepth = null,
  previousAgentOpen = false,
} = {}) {
  if (agentOpen) return PRESENTATION_FOCUS_OWNERS.AGENT;
  if (activeDepth) return PRESENTATION_FOCUS_OWNERS.DEPTH;
  if (previousAgentOpen) return PRESENTATION_FOCUS_OWNERS.AGENT_TRIGGER;
  if (previousDepth) return PRESENTATION_FOCUS_OWNERS.DEPTH_TRIGGER;
  return PRESENTATION_FOCUS_OWNERS.NONE;
}
