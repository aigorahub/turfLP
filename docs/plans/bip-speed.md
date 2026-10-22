# Plan: faster exact TURF with HiGHS (BIP speed)

## Mission

Make exact TURF faster for a Next.js service on Vercel and in the browser dashboard, with HiGHS as the only optimizer. The reviewed plan of turf-astra (final copy below, "Reviewed plan") is the source of truth. This file adds Run Control, acceptance IDs, and John's additions.

Base: main at 797a2a225ff6b7e0c7210f0ba222609de864c61c (v0.3.0 plus PR #20). CI on that commit: R-CMD-check, conformance-r, python, js all green.

## John's additions (2026-10-21)

Two measured experiments join the plan. Both keep exactness: HiGHS or a proved bound decides every stage.

- Greedy incumbent: the plan's optional B4 MIP-start experiment. A greedy portfolio (each step adds the product with the most new respondents, fixed products first) is the incumbent for the first reach stage, passed only through a valid MIP start of the pinned runtime.
- Skip a solve when a portfolio meets a proved bound (B3 and B4 experiment).
  - Reach: the witness is a cheap portfolio (greedy, or the highest-frequency portfolio) of exactly `size` candidates that contains every fixed product. If it reaches every reachable respondent (M), its reach is optimal and the reach solve is skipped. The witness becomes the stage's selection, and the next stage gets the same reach bound row a solved stage gives (uncovered sum <= 0). A witness of another size, or without every fixed product, proves nothing and is not used.
  - Frequency: the bound is the sum of the fixed reaches plus the top `size - |F|` free reaches. The check applies only to the portfolio that enters the frequency stage, after every earlier bound (reach, and penetration when penetration comes first, including the pool and its fallback). If that portfolio's frequency equals the bound, the frequency solve is skipped, the portfolio is the stage's selection, and the next stage gets the same frequency bound row (frequency >= bound).
  - Kept only if measured faster; the answers can differ only among tied optima.

The Required-behavior sentence "HiGHS still solves every optimization stage" reads, for this run: "HiGHS solves every optimization stage, except a stage whose optimum a cheap portfolio meets at a proved bound (John's additions)."

## Run Control

- Driver: turf-opus (Claude Opus 5.5), Herdr workspace wCJ. Work driver: host-native. Branch feat/bip-speed. Draft PR early.
- Reviewers (read-only): turf-astra (Codex, pane wCJ:p2), turf-grok, turf-agy (always `/boost`). Each batch: one full review and one delta review from two reviewers (astra and grok); the final head: all three. No third round for a batch; open blockers go to John.
- Merge and release: authorized by John in this session (2026-10-21), after all reviews are green and CI is green on the exact head. Regular merge commit. Release tag v0.4.0 on the merge commit with turflp-dashboard.html; then redeploy turf.aigora.ai from the release build. A release starts publish-python (PyPI) and publish-npm (npm fails until the npm trusted publisher exists; not a release blocker).
- Vercel benchmark project: turflp-bench in team aigora-ai (separate from turflp-dashboard). It receives only synthetic or public data.
- B6 scope: pending John. Default if he does not decide: harden js/examples/nextjs (worker, whole-job deadline, admission caps, HTTP error classes, forward fixed, bounded result cache, HTTP tests, one real deploy in turflp-bench). Durable tenant-bound jobs and tenant-scoped caches become an issue for a service repository.
- No AI attribution in commits or PRs.

## Batches

### Batch 1 [B1]: Measure and prove deployment support

Acceptance criteria:
- [x] B1-A1: A repeatable benchmark command with frozen inputs (the plan's case list), recorded versions, lock files, and input checksums.
- [x] B1-A2: A local baseline table: phase costs (validation, preparation, CSR assembly, passModel, each stage, pool solves, result checks), model rows, columns, and nonzeros, total time, and memory, for every frozen case.
- [x] B1-A3: The pinned highs runtime is checked by calls, not types, for row addition and deletion, objective and row-bound changes, option reset, zeroAllClocks, and a MIP start; the result decides B4.
- [x] B1-A4: Vercel feasibility in turflp-bench: the example route deployed, worker_threads, WASM loading, and worker termination proved or disproved, and the B6 execution path selected.
- [x] B1-A5: The latency budget and memory and queue caps are set from the measurements.

### Batch 2 [B2]: Prepare once and bitset kernels

Acceptance criteria:
- [x] B2-A1: An internal immutable prepared representation is reused across sizes and the default minimum cover; fixed-specific state is separate and never mutates the original sets.
- [x] B2-A2: Bitset operations pass boundary tests at 31, 32, 33, 63, 64, and 65 respondents, empty sets, and complements.
- [x] B2-A3: Packed and original calculations agree; input order and public validation are unchanged; memory is bounded.
- [x] B2-A4: A WASM 64-bit kernel is measured against the JS kernel; the retained kernel improves a measured workload, or the change is recorded as rejected.

### Batch 3 [B3]: Exact row reduction

Acceptance criteria:
- [x] B3-A1: docs/algorithm.md documents the fixed-cover removal and the weighted residual groups, with the proof of exactness and the covered and uncovered bound rules.
- [x] B3-A2: Reduced and original models agree with the exhaustive oracle and the conformance suite of all ports, with the reduction on and off.
- [x] B3-A3: The plan's regression fixtures pass, including unequal weights, unreachable respondents, fixed products covering everyone, a needed candidate with zero residual reach, residual twins with different original reach, and the pinned unique optima.
- [x] B3-A4: Minimum cover and default sizes agree; the empty-residual model is valid; a false constant bound is infeasible.
- [x] B3-A5: The skip-a-solve checks (John's additions) are measured and kept or rejected.
- [x] B3-A6: The retained reduction passes the performance gate, or it is restricted to the workloads where it passes.

### Batch 4 [B4]: Model reuse within a job

Acceptance criteria:
- [x] B4-A1 (not applicable: model reuse rejected by measurement, see the log): One native model per size job holds stage bounds and cuts; the penetration fallback never inherits pool-only rows; models are disposed on success and failure.
- [x] B4-A2 (not applicable: model reuse rejected by measurement, see the log): Tests cover option and clock resets (finite to unlimited, decreasing limits, repeated solves), first-stage failure, fallback, zero pool budget, timed pool exhaustion, presolve on and off, and different fixed sets.
- [x] B4-A3: The greedy MIP start is measured and kept or rejected.
- [x] B4-A4 (not applicable: model reuse rejected by measurement, see the log): Retained reuse lowers measured total time.

### Batch 5 [B5]: Dashboard

Acceptance criteria:
- [x] B5-A1: The dashboard uses the same preparation and reduction rules, with distinct names for group count, reachable count, and respondent count.
- [x] B5-A2: Dashboard analysis and package results agree; weighted frontier and tie-count fixtures pass; contributions sum to the original reach.
- [x] B5-A3: typecheck, test, build, and test:browser pass in both browser modes, with the fixed-change-during-run, sort, filter, and focus behavior kept.
- [x] B5-A4: Preparation is per run, cancellation and the queued cover work, and no buffer the UI uses is detached.

### Batch 6 [B6]: Bounded Next.js requests on Vercel

Acceptance criteria:
- [x] B6-A1: fixed works through HTTP; malformed input and limits give 400, 413, 429 or 503, 504, and 500 as stated.
- [x] B6-A2: Solves run off the request thread; a whole-job deadline terminates a worker, and no capacity is lost after a timeout or crash.
- [x] B6-A3: The deployed example in turflp-bench meets the latency and resource budget of B1.
- [x] B6-A4: The durable-job and tenant parts are built as John decides, or recorded as an issue.

### Batch 7 [B7]: Conditional native HiGHS comparison

Acceptance criteria:
- [x] B7-A1: A measured decision to keep WASM or use native HiGHS for named job classes, or B7 is skipped with its measured reason.

### Batch 8 [B8]: Docs and version

Acceptance criteria:
- [ ] B8-A1: README.md, js/README.md, python/README.md, dashboard/README.md, js/examples/nextjs/README.md, NEWS.md, and docs/algorithm.md match the code.
- [ ] B8-A2: Version 0.4.0 in DESCRIPTION, python/pyproject.toml, python/uv.lock, python/src/turflp/__init__.py, js and dashboard package.json and package-lock.json, and README examples.

## Master acceptance

- [ ] M-A1: turf-astra, turf-grok, and turf-agy report no blocking finding on the cumulative diff at the final head.
- [ ] M-A2: Every documented local gate passes on the final head, the Next.js standalone check and the new HTTP and benchmark commands included.
- [ ] M-A3: Every GitHub Actions check on the exact final head is green.
- [ ] M-A4: The PR is merged with a merge commit; release v0.4.0 is published on that commit with turflp-dashboard.html; PyPI has turfLP 0.4.0.
- [ ] M-A5: turf.aigora.ai serves the build of the release (same index.html digest).

## Reviewed plan

### TURF speed plan: keep BIP, add bitsets and smaller models

Status: final. Grok and Agy returned GREEN after one full review and one delta review of this BIP-only plan. Implementation owner: turf-opus. Astra returns to reviewer-only work after handoff. This replaces the earlier speed plan.

John requires HiGHS to remain the BIP solver. Bitsets support preparation, exact model reduction, and result checks. They do not replace HiGHS with enumeration or a custom search. The target is a fast Next.js service on Vercel. The browser dashboard must keep working. Opus will drive implementation after the plan review. Astra will return to the reviewer role.

Reference code: main e92517c7e46033c8ee6ddfd9bffc6ff2f7b5cf45, with advisory fixes reviewed at 7146219. Pin the actual implementation base before B1. Include intervening merged fixes. Read shared code by commit while another agent edits the checkout.

### Required behavior

Keep the public API, input errors and check order, fixed indices, size rules, minimum cover, default size range, criterion order, comparison tolerance, result fields, and warning meanings. Keep the original product indices and names. Equal optima can select different tied portfolios. Do not require identical selected indices unless a test checks a specified symmetry rule.

Keep the original candidate rule: a product is a candidate if its reach in the full input is positive. Keep every candidate variable after reductions. Do not delete products because their residual reach is zero, because another product dominates them, or because their residual columns match. Such products can affect exact size, fixed membership, frequency, penetration, and dashboard tie counts.

HiGHS still solves every optimization stage. Only report a proved optimum when the solver and existing validation permit it. Preserve the package's bounded penetration search and fallback. Timing changes can change whether a search finishes before its deadline. Preserve warnings and deterministic limit cases, not identical elapsed time or identical warning outcomes under a nonzero time budget.

JS is the first implementation target. R and Python remain independent reference implementations. Equivalent internal models can differ between ports. A change to observable mathematical rules is outside this plan. Document equivalent reductions in docs/algorithm.md and test against all ports.

### Architecture

Validated input -> immutable prepared data -> fixed-specific reduction -> sparse BIP -> HiGHS -> checks on original data -> result.

HiGHS takes sparse numeric constraints, not packed bitsets. Keep that interface. Use bitsets to reduce preparation work and, where safe, reduce the number of constraints and coverage variables passed to HiGHS. Keep mutable solver models inside one job. Never share one between callers.

The current JS adapter rebuilds CSR arrays and creates and disposes a HiGHS model on each solve. Its WASM build is single thread and blocks the calling JS thread. The current Next.js example loads the solver at module scope. Fluid Compute can help instance reuse and startup. It does not make one synchronous solve parallel. Measure startup, preparation, model transfer, solver work, and queue delay separately.

### B1. Measure the current code and prove deployment support

Create an isolated checkout. Record its commit, lock files, runtime and solver versions, architecture, region, resource settings, and input checksums. Confirm green checks on the exact starting commit. Use synthetic or public datasets in a separate benchmark project. The Next.js example has no lockfile at this reference commit. Its standalone script installs dependencies in a temporary copy. Run that existing baseline check as written and record resolved versions. For benchmark comparisons, create and retain a lockfile in the isolated benchmark project, then use that same dependency set for both variants. Record the packed turfLP artifact checksum too. Do not compare variants with different resolved dependency versions.

Instrument input parsing, validation, packing, reduction, CSR assembly, passModel, each optimization stage, pool solve count, result validation, total CPU time, peak memory, and total request time. Record model rows, columns, and nonzeros before and after each reduction. Record success, warnings, timeouts, and cost per successful solve. Keep instrumentation optional.

Freeze cases before comparison: gen-bench-200x20, gen-bench-200x40, ham, icecream, cafe, identical-300, and penetration near ties. Add sparse and dense cases, many duplicate respondent rows, no duplicate rows, fixed products with high coverage, zero residual reach, and candidates with zero residual reach but positive full reach. Use valid sizes 3, 5, and 8, plus size equal to the fixed count. Test no fixed products, two fixed products, a later identical twin fixed, and a fixed set covering all reachable respondents. Test reach only and both criterion orders.

Separate cases allowed by the current HTTP admission policy from larger engine and durable-job cases. Do not bypass the admission limit and call the result an inline request benchmark. Measure model reductions alone, model reuse alone, and their combination. Keep the original implementation as the comparison path.

For warm cases, use 5 warmups and at least 30 measured samples. For load cases, use at least 100 requests per condition and repeat comparisons three times in interleaved order. Test concurrency 1, 2, 4, and 8. Report fresh-instance requests separately with instance IDs and sample counts. Do not infer a cold start from a delay. Keep failures and externally stopped runs in the report. Mark timeout measurements as censored. Measure cache hits and cache misses separately. Use cache misses to measure solver changes. State the cache-hit ratio in service load results; do not describe a cache hit as a faster solve.

Test the real deployed Node.js route with Fluid enabled. Compare the available Standard and Performance resources. Check current limits in the deployed project. Verify worker_threads, worker bundle paths, WASM loading, termination, and request lifetime. The standalone build test alone does not prove Vercel support. Use a production environment in the separate benchmark project when measuring Vercel bytecode caching. Select and prove an execution path before B6: Vercel workers if supported, otherwise the supervised external WASM runner defined in B6. Include the fallback network and serialization costs in its benchmark.

B1 acceptance: a repeatable benchmark command, frozen inputs, the baseline table, phase costs, model sizes, and a Vercel feasibility result. Set the interactive latency budget and memory/queue caps from these results before changing admission. No claimed speed gain without measurements.

### B2. Prepare data once and add bitset kernels

Create an internal immutable prepared representation. It owns the full respondent count, original column order, candidate map, original column reach, original column identity, and the data needed to assemble constraints. Reuse it across explicit size sweeps and the default minimum-cover solve. Keep fixed-specific state separate. Never clear fixed-covered bits in the immutable full-input bitsets. Build residual sets in separate storage or views that cannot mutate the original sets. Preserve validation at its current public boundary, including empty sizes, invalid options, and all-zero input.

Pack each product's original respondent set into Uint32Array words as the first portable implementation. Add tested operations for union, intersection, difference, equality, set-bit iteration, and population count only where used. Mask unused bits in the last word. Treat JS bit operations as 32-bit operations and normalize signed intermediate values where needed. Test respondent counts 31, 32, 33, 63, 64, and 65, including a hit in the last valid bit. Test empty sets and complements so padding bits cannot create respondents.

Benchmark a small Rust or C++ WASM kernel with 64-bit OR and popcount against the JS kernel. This is a data kernel, not a solver. Keep data resident for a batch and include packing, copying, loading, and call overhead in the result. Avoid one JS-to-WASM call per word. SIMD is a later measurement within this batch, not a requirement. Use a scalar or JS fallback if support or packaging fails. Do not introduce a BigInt path without measured benefit.

Bitsets are not always smaller or faster than sparse lists. Measure density and total memory, including the original input, packed data, CSR arrays, and worker copies. Do not keep both row and column bitsets unless their measured use justifies the cost. Keep sparse lists or the existing path where they win. Hashes can locate possible equal patterns, but verify equality before using a match for model reduction or symmetry.

Original column reach is popcount over the full input. Original column identity is equality over the full input. Compute frequency and penetration from these original totals. Preserve coefficient scaling, summation order, and each consumer's existing numeric comparison rules. Do not silently change dashboard floating-point rules while sharing preparation code.

B2 acceptance: boundary tests pass; original and packed calculations agree; input order is unchanged; preparation is reused across sizes and default cover; memory is bounded; the retained kernel improves a measured workload. The route and solver still use HiGHS for all optimization.

### B3. Reduce respondent rows without changing the BIP answer

Define N as the original respondent count. Define M as the number of original respondents reached by any original candidate. Globally unreachable respondents remain in N and in the reach proportion denominator. They are absent from coverage constraints, as today.

For a validated fixed set F, compute C as the union of its original respondent sets. Fixed products are guaranteed selected by the fixed row. Remove respondents in C from coverage constraints. Their reach is constant. Keep all original candidate x variables, the size equality sum(x)=size, the fixed equality sum(x in F)=|F|, and full-input frequency and penetration coefficients. Do not subtract |F| from size while also retaining fixed x variables.

For remaining reachable respondents, group rows with identical incidence over candidate variables. Each group g has a positive integer weight w_g equal to its respondent count. Confirm sum(w_g)=M-|C|. Use one continuous variable z_g >= 0 and one row z_g + sum(a_gj*x_j) >= 1 per group. Keep the existing lack of a finite upper bound on z unless a separate proof and review justify changing it.

The reach objective becomes U=sum(w_g*z_g), the number of reachable respondents left uncovered. Report reach as M-U after recomputing U from the selected products. Equivalently, report |C| plus the weighted coverage of the residual groups. Never use the number of groups as the respondent count or as the reach offset.

Every later reach bound must use the same weighted expression. Distinguish internal uncovered-count bounds from public covered-reach bounds. The package currently passes uncovered U, while dashboard atLeastReach takes covered R. Do not apply the M-R conversion twice or pass U as R. Use distinct names and tests at both boundaries. For a required original reach R, the bound is sum(w_g*z_g) <= M-R. Apply this rule to stage bounds, penalty/fallback constraints where applicable, dashboard ranges, tie counts, and the frontier. The public reach proportion remains reach/N. Recompute final fields on the original data rather than trusting continuous z values.

The reduction is exact: fixed products cover C in every feasible portfolio. All members of one residual group have the same coverage for every candidate selection. Its weight therefore preserves the original reach objective and the feasible product selections. Explain this proof in the algorithm document. Test the unchanged selection space and objectives on small exhaustive fixtures.

Minimum cover uses one coverage row per residual group with sum(a_gj*x_j)>=1. It needs no group weight in its objective: minimize sum(x) over all original candidates, with fixed membership retained. Default sizes still start at max(1,|F|) and end at this absolute cover size.

When no residual rows remain, build a valid model with size/fixed constraints and the original tie-break objectives. Keep the original all-zero-input errors. Test solver behavior for zero coverage rows and objective coefficients. Do not return the fixed set as the result of a larger requested size. Minimum cover may return F when F covers all reachable respondents, after the existing validation. If a reach bound has no z terms, evaluate the constant inequality first. A true bound can be omitted if the runtime rejects empty rows. A false bound must return the normal infeasible outcome; never drop it. Test both cases.

Symmetry uses equality of original full-input columns and free candidates only. Do not create new symmetry chains from residual columns. Two products can look identical after C is removed and still have different frequency or penetration. Keep the latest earlier free twin rule. Dashboard tie counts must retain a model without symmetry rows so that separate product choices are still counted.

Required regression fixtures: unequal group weights; unreachable respondents; fixed products covering everyone; size greater than |F| in that case; a needed candidate with zero residual reach; two residual twins with different original reach; fixed later twins; all rows unique; no fixed set; omitted and empty sizes; minimum cover; both criterion orders; and near-tie penetration. Compare reach/frequency exactly and penetration by the normative rule. Keep the existing selected-product assertions for unique regression optima, including stage-40000, retry-35043, near-42000, and flood-402. The permission to choose a different tied optimum does not weaken those tests. Test selected fixed membership and original indices/names.

B3 acceptance: reduced and original models agree with the exhaustive oracle and all-port conformance; min cover and size defaults agree; full coefficients and weighted bounds are proved and tested; no invalid column deletion or residual symmetry appears. Keep reductions only where their total cost passes the performance gates.

### B4. Reuse HiGHS models within one solve job

Verify the pinned highs runtime, not only its type declarations, supports row addition/deletion, objective changes, row-bound changes, and the required resets. Add stage bounds and no-good cuts without rebuilding unchanged base arrays. Keep one model local to one size/analysis job. Do not initially reuse a mutable model across sizes or callers.

Track the exact logical state represented by each native model. The current penetration fallback starts from withoutPool. It must not inherit pool-only bounds or no-good cuts. Prefer a separate model for that branch first. Any later rollback must restore rows, objectives, bounds, limits, and relevant solver state. Apply the complete required solver option state before every run. In particular, reset a previous finite time_limit to the pinned runtime's documented unlimited value when the next stage has no limit. Omitting the option does not reset a reused model. Reset the model solve clocks before each run with zeroAllClocks() after verifying the pinned API behavior. The old fresh-model adapter starts each solve with fresh clocks; persistent models must preserve that budget meaning. Test finite-to-unlimited and decreasing-limit transitions, plus repeated solves so elapsed time from a prior run cannot consume the next run's budget. Do not assume HiGHS retains a search tree or that reuse gives a warm start.

Dispose models on success and failure. On worker termination, release the worker's whole WASM instance. Preserve failure injection and option checks in existing tests. Replace creation-count assertions only if they no longer represent required behavior. Test first-stage failure, fallback, zero pool budget, timed pool exhaustion, presolve on/off, different fixed sets, and repeated calls.

Optional measured experiment: use bitset greedy gains to build a feasible incumbent for the first reach stage, then pass it to HiGHS only if the pinned API supports a valid MIP start. Include fixed products and exact size, populate auxiliary variables correctly, and validate it first. HiGHS must still perform the optimization and proof. Do not return the heuristic as an optimum. Drop this experiment if it does not help.

B4 acceptance: stage/fallback semantics and solver options remain correct; tests cover state isolation and disposal; retained reuse lowers measured total time. No shared mutable solver state enters a cache.

### B5. Apply the same model rules in the dashboard

Use the internal preparation and reduction layer in the package and dashboard SizeModel, or provide one tested equivalent representation if package boundaries require separate builders. Avoid two undocumented interpretations of weights and offsets. Preserve both the symmetry model for ranges/frontier and the plain model for counts.

Audit all uses of n, colRows, x offsets, reach coefficients, atLeastReach, point(), and selected-product validation. Coverage-group count, original reachable count, and original total count need distinct names. Frontier frequency bounds must still include the run's fixed set. Preserve the dashboard's current numeric rules for penetration; do not replace its arithmetic as an incidental cleanup.

Use original-data bitsets for result checks, contribution gains, and chart totals. Grouped solver rows must not appear as individual respondents in the UI. Preserve fixed-first contribution order, fixed segment colors/labels, stable product slots, and full original product names. Test fixed changes during an active run: keep the run snapshot, queue the cover, and show stale results after completion. Keep filter, sort, and focus behavior from the advisory fixes.

Keep the browser worker and page fallback. In worker.handle(), prepare once per run and pass that state to each size solve. Keep per-size progress replies and the between callbacks when provided. Do not replace the loop with one non-yielding turfSizes call in page mode. Preserve cancellation behavior and the queued cover request. Cache preparation only for the loaded dataset/threshold with an explicit memory bound. Keep fixed-specific reductions keyed by the fixed set. Data or threshold changes must invalidate the relevant state. Retain original run data until the run and its analyses no longer need it. Do not transfer a buffer in a way that detaches data the UI still uses.

B5 acceptance: dashboard analysis and package results agree; weighted frontier and count fixtures pass; contributions sum to original reach; both browser modes pass; no stale-state or buffer-ownership defect appears.

### B6. Bound Next.js request work on Vercel

Keep module-level solver initialization inside each solver worker. If B1 proves worker support, start with one active solver per worker and one worker on Standard. Test one and two workers on Performance. Bound each instance's queue and account for the total RAM of all WASM instances. Do not assume more workers speed one solve or that an instance-local cap is a service-wide cap. Set project/account admission or rate limits for total workload.

If B1 cannot prove WASM worker loading and termination on Vercel, use a supervised Node runner outside the request instance with the same WASM HiGHS solver. It must execute each active job in an isolated worker or child process that a separate supervisor can terminate. Prove loading, isolation, timeout termination, memory recovery, and authenticated internal requests in B1. Next.js waits on this runner for inline work and keeps the existing portfolio response format. Long work uses the durable job API below. This fallback does not depend on B7 or on a native Python port. Benchmark its network, startup, and serialization costs. If neither execution path passes the proof, B6 is blocked; do not ship a synchronous request-thread fallback.

Keep the Node request thread free of synchronous solves. Put large preparation and packing in the worker too. Bound body bytes and validated dimensions before expensive work. Return HTTP 400 for malformed JSON and invalid matrix, size, fixed, or tie-break inputs. Check all rows and public options; preserve invalid-input errors. Forward fixed, which the current example omits. Use 413 for configured payload/admission limits, 429/503 for overload, 504 for the service deadline, and 500 for an unexpected solver/server failure.

Use a whole-job deadline that includes queue time, preparation, stages, and serialization, with margin below the deployed maxDuration. A timer on the blocked solver thread is insufficient. The request supervisor must terminate a timed-out worker, reject its job, and create a replacement as needed. Define queued and active cancellation. Test that jobs settle once and no capacity remains lost after a worker crash or timeout. Preserve the package's stage/pool limit meanings within that outer service deadline.

Use inline requests only for workload classes that meet B1's budget. Send long or unpredictable work through a durable queue with external status/result storage and job IDs. Use a runner whose documented lifetime covers the job. Do not rely on a detached task surviving the HTTP response. Require idempotency, bounded retries, leases or equivalent duplicate control, expiration, and explicit failures.

Bind jobs to the creating tenant and authorized dataset. Authenticate and authorize submission, status, results, streams, and cancellation. A job ID is not a credential. Keep matrices and portfolios out of URLs. Test cross-tenant access, including completed and expired jobs.

Cache validated complete results without unfinished-search warnings. Authenticate and authorize before lookup or coalescing. Key on tenant scope, canonical matrix content or immutable dataset version, threshold, canonical fixed set, size, ordered criteria, algorithm/solver version, presolve and other solver options, maxPool, and maxPoolSeconds. Omitted and empty fixed sets share one canonical empty set. Include names in the key or attach each authorized caller's names after both lookup and coalescing. Bound cache TTL and bytes. Keep prepared-data and result caches separate. Define cancellation for shared work so one caller cannot cancel another caller's result.

Test one real Vercel deployment before release. Confirm cold/warm loading, worker packaging, deadline enforcement, concurrent isolation, overload, and memory recovery. Keep Fluid enabled as the baseline and measure it. Verify actual resource and duration settings rather than relying on historical limits.

B6 acceptance: fixed works through HTTP; malformed inputs and limits return the stated error classes; worker/queue/cache boundaries pass tests; the deployed service meets its measured latency and resource budget. No post-response work depends on a live request instance.

### B7. Conditional native HiGHS comparison

Only if retained changes still miss the target, compare native highspy with WASM HiGHS on the same frozen problems and comparable CPU resources. Start with one thread. Test supported native parallel settings separately. Include startup, data transfer, packaging, memory, solver version, and cost. Match solver versions where possible. Report a version mismatch as a separate cause that can affect the comparison. Where safe model reductions are needed to make the comparison fair, implement and validate them in the native path first.

Next.js remains the API/UI. A durable native runner is an option for heavy work if measurements justify it. It still uses HiGHS BIP with the same public rules. No alternate enumerator, GPU solver, approximate mode, or reduced precision is in scope.

B7 acceptance: a measured decision to retain WASM or use native HiGHS for specified job classes. Either result closes this conditional batch. Do not add an operational service without a material measured benefit.

### Dependencies and release gates

B1 precedes all performance decisions. B2 precedes B3. B4 can start after B2 but must be tested again with B3's model. B5 integrates B2-B4. B6's feasibility work starts in B1; its final load test uses the retained B2-B5 code. B7 is conditional. Ship in separate reviewed batches, not one large rewrite.

Provisional performance gate: at least 20% lower warm median total time on a declared primary workload; no more than 10% p95 regression in any required class; no higher error or timeout rate; and bounded memory. Pair completed-run latency with completion rates. Retain failures/timeouts in the full report. Never average away a severe regression or hide slow cases. Report CPU cost separately. Drop or restrict changes that fail the gate. Isolated preparation savings do not prove faster end-to-end solves.

Correctness gates use the smallest tests that catch wrong answers, lifecycle failures, or input-boundary failures. Use the existing exhaustive generator as an oracle. Add targeted fixtures for the new reductions and bit boundaries. Do not require exact selected indices for arbitrary tied optima. Check full product fields and all fixed requirements. Run the affected gates after each change; run the full set on the final head.

Commands at the reference commit:

```sh
# Repository root
python3 conformance/generate.py --check
python3 conformance/test_generate.py
Rscript -e 'testthat::test_local()'
Rscript conformance/run_r.R

# python/
uv sync --locked --extra test
uv run --locked pytest

# js/
npm ci
npm run typecheck
npm test
npm run build
npm run test:conformance

# dashboard/, after js build
npm ci
npm run typecheck
npm test
npm run build
npm run test:browser

# js/examples/nextjs/, after js build
# This script installs and builds a temporary copy with the packed local package.
node scripts/standalone-test.mjs
```

Add the HTTP, worker, authorization, and benchmark commands with their implementations. Pin them in the implementation log. Use locked installs where the repo supplies a lockfile. Use the frozen benchmark project for performance comparisons. The existing example standalone check is a packaging check and uses its own temporary install; do not claim that this check uses a lockfile. If an audit endpoint stalls, record the issue and use --no-audit for the install; do not call that a completed security audit.

Final release requires green checks on the exact head, both reviewers' findings resolved, conformance across ports, the real deployment evidence, and a rollback path. Keep the old solver path during rollout with a recorded version/feature setting. Do not share caches across incompatible algorithm versions. Merge and production deployment require John's explicit authorization in the active implementation session.

### Ownership and review

Opus drives the implementation, branch, tests, and delivery. Astra reviews exact commits and does not edit product code. Grok and Agy review this plan. Each implementation batch gets one full review and one delta review from two reviewers. The final review uses all configured reviewers. After the delta, report any remaining blocker or disagreement to John. Do not start a third review round for the same batch.

Record each retained change, rejected experiment, measured result, acceptance result, and exact commit. Report completed batches against the seven planned batches. Mark B7 as skipped with its measured reason when it is not needed.

### Sources and review record

Sources checked during planning:

- [HiGHS sparse model API](https://ergo-code.github.io/HiGHS/dev/interfaces/c_api/).
- [WebAssembly numeric instructions](https://webassembly.github.io/spec/core/text/instructions.html).
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute).
- [Vercel function memory and CPU](https://vercel.com/docs/functions/configuring-functions/memory).
- [Vercel usage and pricing](https://vercel.com/docs/functions/usage-and-pricing).
- Source at the reference commits: js/src/core.ts, js/src/solver.ts, dashboard/src/analysis.ts, dashboard/src/contrib.ts, dashboard/src/worker.ts, js/examples/nextjs/app/api/turf/route.ts, docs/algorithm.md.

New BIP-only plan review: Grok found a missing execution path if Vercel worker support fails. V2 adds a supervised external WASM runner and requires B1 to prove the selected path. It also clarifies original bitset ownership, covered versus uncovered bounds, constant reach bounds, and unique-optimum test pins. Astra corrected the Next.js gate and added frozen dependency and cache-miss benchmark rules. Agy returned GREEN with advisories. V2 adds explicit per-run clock/option resets, preparation reuse inside worker.handle() while keeping between callbacks, and safe empty-bound handling. The optional MIP start is limited to the first reach stage. Native comparisons must report solver-version differences. Both delta reviews returned GREEN for bip-plan-v2.md. No blocking findings remain. Grok's final advisory asked for explicit HTTP 400 wording for invalid matrix, size, fixed, and tie-break inputs; the final copy makes that existing rule explicit. This copy otherwise adds only final status and this review record. No third review round was run.

Astra also checked the fixed-cover and weighted-row reach formulas on 1,000 seeded binary matrices. All 9,044 feasible portfolio comparisons preserved exact reach and the offset. This was a planning check, not a benchmark or an implementation test.

The earlier enumeration plan is superseded. Opus owns the seven implementation batches. Astra reviews exact commits. No product code was changed to produce this plan.
