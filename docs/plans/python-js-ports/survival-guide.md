# READ THIS FILE FIRST AFTER ANY COMPACTION OR RESTART

Read order after compaction: this guide -> `.elves-session.json` -> `docs/plans/python-js-ports/learnings.md` -> `docs/plans/python-js-ports/plan.md` -> `docs/plans/python-js-ports/execution-log.md`.

## Mission

Add Python (`python/`) and JavaScript/TypeScript (`js/`) ports of turfLP that use HiGHS and the same algorithm as the R package, bound by a shared conformance suite (`conformance/`) with expected values from exact enumeration. Land the PR after all four peer agents are satisfied.

## Run Control

- **Run mode:** finite
- **Stop policy:** blocker-only
- **User intent:** "plan and stage this work as an /elves run then get the other agents in this repo to review the docs, then revise. once the plan is staged and ready, complete the run" and "complete the elves run after planning and review is complete, then get all agents to review the finished run, fix and re-review in a loop until all agents are happy or obviously wrong, then land the pr"
- **Checkpoint due by:** none
- **Checkpoint semantics:** none
- **May continue after checkpoint:** yes
- **Actual stop conditions:** PR landed after all four agents have no unresolved blocking finding, or a genuine blocker.
- **Workspace ownership:** dedicated worktree `/Users/john/aigora/dev/turfLP-python-js-ports` on branch `feat/python-js-ports`, created with the Elves preflight helper. The peer agents work read-only in their own worktrees.
- **Branch tip at start (collision tripwire):** `ebea497080b292cc31e50d7450b92f06b6855ba2`
- **Merge policy:** merge-commit-on-green, authorized by the user for this run after all four agents are satisfied; regular merge commit only, never squash.
- **Final-response policy:** disallowed until the PR is landed or a hard stop.
- **Coordination mode:** Cobbler-first for planning and review synthesis; direct execution for mechanical work.
- **E2E mode:** chat-to-land
- **Work driver:** host-native
- **Implementation lane:** fast
- **Delegation scope:** none
- **Git mode:** host_only
- **Driver monitor mode:** interactive
- **Driver review policy:** plan review by the four peer agents before implementation (done); final independent review by turflp-astra and turflp-agy, looped until clean. The user removed turflp-grok and then turflp-fugu from further reviews on 2026-09-26.
- **Risk posture:** standard (B3 high)
- **Trust mode:** trusted
- **Landing outcome:** complete_and_merge
- **Driver merge authorized:** yes, by the user for this run, after the four agents are satisfied and final readiness passes
- **Worker merge authority:** false
- **Stable plan IDs:** batches B1-B4, criteria B#-A#, master M-A#
- **Staging acceptance command:** `python3 "$ELVES_SKILL_ROOT/scripts/acceptance_contract.py" validate --repo-root . --session .elves-session.json`
- **GitHub push auth route:** host `gh` projection
- **Continuation rule:** If work remains and the stop conditions are not met, continue without waiting for the user.

## Cobbler Session State

- **Cobbler default:** on
- **Activated by:** Elves invocation
- **Scope:** current Elves run
- **Persistence:** survival guide and `.elves-session.json`

## Session Budget

- **Started:** 2026-09-26 21:53 EDT
- **User returns:** not stated

## Stop Gate

- **Stop allowed right now:** no
- **Reason:** B2, B3, B4, final reviews, and landing remain.

## Deferred hygiene

- none yet

## Out-of-scope findings

- none yet

## Non-Negotiables

See the plan. Do not change R algorithm behavior. Expected conformance values come from exact enumeration. Same algorithm, limits, tolerance, and warnings in all three languages. No publishing. No AI attribution. Regular merge commit only.

## Current Phase

executing: B1, B2, and B3 complete.

## Next Exact Batch

B4: CI workflows, READMEs (with the benchmark numbers from the execution log), NEWS, and the R turf_min_cover issue.

## Plan and Log Paths

- Plan: `docs/plans/python-js-ports/plan.md`
- Learnings: `docs/plans/python-js-ports/learnings.md`
- Execution log: `docs/plans/python-js-ports/execution-log.md`
- Session: `.elves-session.json`
- Reviews: `/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/ea7aeaf6-8fd0-4818-85ee-d90f3bf01469/scratchpad/reviews/`
