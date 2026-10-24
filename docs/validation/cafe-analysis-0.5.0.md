# Cafe analysis check

Source: d3d326952f97dd20044baaf7b4f0ba18ccd1af66. Node 26.12.0 on macOS. Date: 2026-10-23. Dataset: built-in cafe, 2,500 respondents and 40 binary products. No fixed products. Budgets: baseline 10 seconds, frontier 30 seconds.

The JSONL file records the public API beside the previous dashboard path. Both use the same solver. The old path supplies the solved optimum and the most popular endpoint. The public API computes these itself because callers cannot certify optimality.

| Size | New baseline | New frontier | Old frontier | New / old points |
|---|---|---|---|---|
| 3 | complete, 0.047 s | complete, 4.119 s | complete, 0.249 s | 2 / 2 |
| 5 | complete, 0.003 s | complete, 21.329 s | complete, 8.978 s | 6 / 6 |
| 8 | complete, 0.003 s | time, 30.082 s | time, 30.005 s | 5 / 7 |

No run changed from complete to time. Size 8 returns fewer completed points within the same budget. The private app must state when the frontier is incomplete. Its Stop action terminates the worker and discards an unfinished deep dive. Timing includes public input conversion; budgets are not strict wall-clock limits on loading and preparation.

These values are a local acceptance check, not a performance guarantee. Concurrent test processes were active. The committed numerical tests check correctness independently of timing.
