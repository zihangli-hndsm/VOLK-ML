import { createContext, useContext } from 'react';

export const WorkspaceGraphProposalContext = createContext(null);

export function useWorkspaceGraphProposalSubmission() {
  const submitProposal = useContext(WorkspaceGraphProposalContext);
  if (typeof submitProposal !== 'function') {
    throw new Error('Workspace graph proposal submission is unavailable outside the Build workspace.');
  }
  return submitProposal;
}
