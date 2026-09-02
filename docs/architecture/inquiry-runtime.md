# Inquiry Runtime

Episode 1 is the reference local-first inquiry runtime. A versioned
`ExplorationContractV1` describes World, sampling, model, experiment and
observable capabilities. An `OrchestrationContractV1` describes the question,
small inquiry graph, evidence rule, concept eligibility, guidance budget and
continuation hooks.

The host remains the single runtime owner. After a committed action it
normalizes semantic events into the bounded Semantic Event v2 store. The
detached `inquiryRuntime` snapshot is a projection of that store plus contract
facts; it is never a second World, Dataset or Experiment reducer.

Episode 1's detector (`sampling-variability-linear-fit-v1`) requires the same
semantic World and configuration, different sample realization/Dataset
identity, two current fits and an exact comparison. Fitted-line movement is
computed from model parameters over the union training range, never from screen
geometry. Structural evidence may be `valid-weak`; only threshold-crossing
movement makes `SAMPLING_VARIABILITY` eligible.

LUMI actions are typed proposals. Proposal-bearing actions carry
`authority: suggestion-only` and require learner acceptance. A missing or
malformed Cloud policy falls back to the deterministic local policy. Guidance
budgeting, cooldown and dismissal history are presentation context; they
cannot mutate experiment truth.
