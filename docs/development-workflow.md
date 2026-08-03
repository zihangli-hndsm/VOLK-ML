# Development workflow

VOLK-ML work follows four ordered stages:

```text
Design -> Development -> Acceptance -> Pull request
```

A pull request is the publication of work that has already passed acceptance. It is not the place to discover the goal, invent the test plan, or run an automated review-and-submit loop.

## 1. Design

Before editing executable code, the user and developer agree on a written design record. For small changes this can live in the task conversation; larger changes should use an issue or a document under `docs/`.

The design record must state:

- the user-visible or technical goal and why it matters;
- what is in scope and explicitly out of scope;
- the affected contracts, components, data formats, and architecture documents;
- the implementation approach and important alternatives or risks;
- the acceptance criteria;
- the exact tests and validation commands that must pass;
- any manual scenarios, supported languages, frameworks, browsers, or migration cases that must be checked.

Questions that materially change behavior, scope, compatibility, or acceptance must be resolved in this stage. Development begins only after the user accepts the design. If implementation reveals a material design gap, stop and return to Design instead of silently widening the scope.

## 2. Development

Implement only the accepted design.

- Keep changes focused on the agreed scope.
- Follow `AGENTS.md` and the relevant architecture documents.
- Keep code, tests, localization, migrations, and architecture documentation synchronized.
- Add or update focused regression coverage as specified by the design.
- Record necessary deviations and obtain user agreement before continuing when they change behavior, scope, or acceptance.

A development branch may be used to preserve work, but opening a pull request belongs to the final stage.

## 3. Acceptance

After implementation, run the complete test plan agreed during Design. Acceptance is a separate gate, not an implicit consequence of finishing the code.

Provide an acceptance report containing:

- each acceptance criterion and its pass/fail result;
- every automated command run and its result;
- manual scenarios checked and the observed result;
- relevant artifacts or evidence;
- known limitations, skipped checks, and the reason for each;
- any difference between the accepted design and the implementation.

The baseline repository checks remain:

```bash
npm run check
npm run build
git diff --check
```

These commands are a minimum, not a substitute for task-specific tests. `npm run check` and `git diff --check` are required for every change. A documentation-only change may omit `npm run build` when the accepted design does not require an application build, but must still run the required core checks and proportionate validation such as link, formatting, and consistency checks.

A failed or skipped required check means acceptance has not passed. Fixes return to Development and the affected acceptance checks must be rerun. The user decides whether the evidence satisfies acceptance when judgment or a product decision is involved.

## 4. Pull request

Open a pull request only after acceptance passes.

The pull request must summarize:

- the accepted goal and design;
- the implemented changes;
- the acceptance criteria and test evidence;
- limitations, follow-up work, and any accepted deviations.

Do not use a Codex automated review-submit loop. In particular:

- do not repeatedly post `@codex review`;
- do not treat automated review as a replacement for the agreed acceptance plan;
- do not continuously fix, resubmit, and re-request review without returning the results to the user.

CI or reviewer feedback after the pull request is opened is handled as a new validation signal. Diagnose it, report how it affects the accepted design, and make in-scope fixes with the user's direction. Material changes return to Design; fixes return through Development and Acceptance before the pull request is updated.

## Stage gates

| Transition | Required gate |
| --- | --- |
| Design -> Development | User has accepted the goal, scope, approach, acceptance criteria, and test plan. |
| Development -> Acceptance | Implementation is complete for the accepted scope and supporting tests/docs are present. |
| Acceptance -> Pull request | All required checks pass, evidence is reported, and no unresolved acceptance blocker remains. |
| Pull request -> further changes | Feedback is classified; any fix passes through Development and Acceptance again. |
