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

## Director handoff

`src/core/director/directorPrototype.js` is a declarative, presentation-only
eight-beat orientation. Its reducer supports deterministic play, pause, seek,
reset and replay; it never appends semantic events. The Explore Home CTA and
Skip action call `openPhaseAHandoff` with the Episode 1 id and seed `7101`,
opening the bounded onboarding workspace before inquiry promotion. Director
debug controls are development-only and expose beat/time and handoff identity
without telemetry.

The Episode panel provides optional, non-blocking onboarding invitations and an
optional reflection stored in inquiry-session metadata. Reflection text is not
fed to the deterministic detector and cannot create Evidence or execute an
experiment.

## Phase A journey

The Director CTA opens a separate `phase-a:*` workspace through
`openPhaseAHandoff`. This workspace uses the Episode 1 World and model
capabilities but has no orchestration contract, so its presentation prompts
cannot create inquiry milestones. Learner buttons and World tools dispatch the
normal host actions and therefore produce the ordinary Semantic Event v2
records. Once at least one meaningful learner event exists, the bounded
question trigger calls `promotePhaseAInquiry`; the host is idempotent and
reinitializes the clean Episode 1 session exactly once. Direct Big Idea cards
continue to call `openBigIdeaEntrance` independently of this handoff.

For the executable architect workflow, run `npm run dev:all` and open
`http://localhost:5173/?directorDebug=1`. The development-only Explore bar
launches or restarts onboarding and enters Episode 1 directly; Director debug
includes arbitrary implemented-beat selection. See
[`docs/local-development.md`](../local-development.md) for the complete
shortcut and clean-reset sequence.

## Explore attention surfaces

Explore keeps the primary World, Experiment and Evidence loop visible while
placing the Notebook, Concept Map, hypotheses and other research tools behind
an explicit secondary-surfaces disclosure. The Notebook is a bounded view of
the session's semantic trail; `src/core/ui/journeyProjection.js` coalesces
consecutive human World changes and resamples into compact milestones while
retaining source event IDs for inspection. Presentation, pointer and camera
state are never projected as learner milestones.

LUMI is a persistent, compact companion owned by Explore presentation. Its
semantic body states are AMBIENT, OBSERVE, THINK, GUIDE, NOTICE and
ILLUMINATE; opening the companion only reveals existing guidance, Evidence or
Ideas Map surfaces. `src/core/ui/lumiCompanion.js` is a pure resolver over a
bounded semantic projection, so state changes cannot create events or mutate
World/Experiment truth.
It never executes a proposal. Empty concept frontiers stay hidden until a
deterministic candidate exists. Episode 1's fitted regression line appears only
after a committed fit, and its A/B overlay uses stored fit parameters rather
than screen geometry. These are presentation projections over authoritative
runtime facts and do not mutate the inquiry.

The embodied visual mapping uses optimized, transparent PNG derivatives of the
canonical concept artwork supplied for Phase A.8:

| Companion state | Runtime asset | Role |
| --- | --- | --- |
| AMBIENT | `src/assets/lumi/lumi-ambient.png` | idle/fallback/avatar |
| OBSERVE / NOTICE | `src/assets/lumi/lumi-observe.png` | notice an observation |
| THINK | `src/assets/lumi/lumi-think.png` | policy/Ask busy state |
| GUIDE | `src/assets/lumi/lumi-guide.png` | bounded nudge |
| ILLUMINATE | `src/assets/lumi/lumi-illuminate.png` | deterministic concept event |

There is no separate THINK asset in the legacy set; the new `lumi-think.png`
derivative is used directly. Motion is a subtle glow/orbit and is disabled
under `prefers-reduced-motion`. The canonical 1254px masters remain source
artwork outside the shipped bundle; the 256px derivatives keep the floating
companion lightweight at desktop and compact sizes.

When `SAMPLING_VARIABILITY` becomes eligible from deterministic Evidence, the
host performs one idempotent presentation illumination and the companion
announces the connection. This is an Encountered/Evidenced signal, not a
mastery claim. Continuation questions are proposals that focus an existing
surface; selecting one never runs an experiment automatically.

## Orchestration Runtime v1 and Episode 0

Frontend-authored Episodes live in `src/episodes/`. The Episode 0 registry
entry (`episode-0-world-data-model`) separates its orchestration contract from
the existing Director presentation contract. `src/core/orchestration/` derives
the current stage, completed milestones, learner momentum, fallback level,
semantic target, and continuation options from Exploration snapshots and
Semantic Event v2 records. It stores only small learner-choice memory such as
prediction, reflection, guidance dismissals, and continuation selection; World,
Experiment, fit, comparison, and Evidence remain Exploration-owned.

Episode 1 remains a compatibility alias for the same World/Data/Model inquiry,
so existing direct entries and API consumers continue to work while Episode 0
provides the course-opening narrative. Semantic affordance targets such as
`world.canvas`, `world.noise`, and `experiment.compare` are stable contract IDs
resolved by the current Explore UI. LUMI receives only the bounded orchestration
projection and remains suggestion-only.

## Experiment design handoff

Ask LUMI returns separate learner-facing copy (`question`/`message`) and a
bounded semantic design request. Only that typed request is accepted by
`playgroundHost.proposeExploration`; it is converted to a validated pedagogical
design and then to a deterministic `ScenarioSpec`. Legacy string suggestions
remain display-only and are rejected at the Agent boundary, so confirmation
wording can never become an executable task. The
`more-same-distribution-data` goal changes Train sample count while holding the
generating process, model, and evaluation configuration, and still requires
learner approval.

World Generator capabilities are exposed independently as
`canUseWorldPresets`, `canDesignWorldFromNaturalLanguage`,
`canExecuteWorldRecipe`, and `canEditCurrentWorldRecipe`. Presets use the local
recipe validator/materializer and work without a provider; free-form World
interpretation may require a configured provider. Neither path executes until
the learner accepts the rendered proposal.
