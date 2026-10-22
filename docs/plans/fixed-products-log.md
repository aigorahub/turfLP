# Execution log: fixed products

- 2026-10-21: design agreed with turf-astra, turf-grok, turf-agy (three rounds; all AGREE on v3). John authorized the run, merge, and release v0.3.0. turfLP 0.2.0 is on CRAN, so 0.3.0 is not blocked by a pending review.
- 2026-10-21: branch feat/fixed-products from 06afb81. Plan, survival guide, log, session written.
- 2026-10-21: planning review round 1 at 7f9d5ae. agy GREEN. astra: locked Python gate; master acceptance for CI, merge, release. grok: runners must load fixed cases; data and threshold criterion; locked Python gate; advisories (NULL/undefined exemption, print criterion, maxFrequency assert, js npm ci before dashboard). All fixed.
- 2026-10-21: planning review round 2 at 92f764e: astra, grok, agy GREEN.
- 2026-10-21: B1 done: spec in docs/algorithm.md, generator fixed enumeration, fixtures/fixed.json (155 cases), conformance/README.md. Existing runners ignore fixed.json, so CI stays green until B2 and B3 load it.
- 2026-10-21: B1 review at 1a02f17: astra, grok, agy GREEN. Advisories: runners in B2/B3 (done there); all-zero order follows the per-function list (as implemented).
- 2026-10-21: B2 done: R turf.R (check_fixed, check_fixed_reach, fixed row, free-only symmetry, post-solve check, fixed field, print), run_r.R fixed loop, testthat tests, man/. run_r.R all pass (fixed 155). R CMD check: version WARNING only (0.2.0 on CRAN), cleared in B5.
- 2026-10-21: B2 review at 879b508: astra GREEN, grok GREEN (advisory: turf_min_cover help inherited "size counts them"; fixed in the next Review commit). agy exited during the review; restarted in wCJ:p4 with the same command line.
- 2026-10-21: B3 done: Python and JS ports (check_fixed, check_fixed_reach, fixed row, free-only symmetry, post-solve check, fixed field), conformance loops, error and twin tests. pytest 3898 passed; JS vitest 81 passed, test:conformance all pass with fixed 155 cases, presolve on and off. dashboard plain() and two test literals carry fixed so the dashboard still compiles.
- 2026-10-21: B3 review at ee157f8: grok GREEN (advisory: reject a set for fixed; done). astra still running. agy exited again; the disk filled (847 MB free, /private/tmp/da-release-* from another project hold about 7 GB).
- 2026-10-21: John freed disk space (22 GB free). astra B3 at ee157f8: two blockers (dict accepted; fixed=[10**400] raised OverflowError). Dict rejected in ab53c30; overflow fixed next, test fails without the fix. astra weekly limit now 0%: grok and agy review from here. agy restarted again.
- 2026-10-21: B4 done: dashboard fixed products (settings list with filter, run/cover/analyze carry fixed, analysis fixed row and maxFrequency, contributions fixed first, marks, CSV column, data and threshold rules). typecheck, vitest 58, build, test:browser worker and page mode pass.
- 2026-10-21: B5 done: READMEs, NEWS 0.3.0, version 0.3.0 with lock files.
- 2026-10-21: B4 review at 740b0ca: grok GREEN (advisory: more than 8 fixed products share the top "other" color segment; display only). B4 and B5 review at 1efc350: agy GREEN, gates in a clean clone pass. CI on 1efc350 running.
