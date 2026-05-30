# Blind-baseline smoke test

The cheapest, most reliable way to prove (or disprove) leakage. If a baseline
that *cannot* perform the real task still scores high, the eval is leaking.

For the concrete dual-run recipe (run the real pipeline twice, once with the
leak channel intact and once sanitized) see
[blind-baseline-runner.md](blind-baseline-runner.md). Before trusting any
number, confirm the run actually exercised the channel — see
[validating-the-harness.md](validating-the-harness.md).

## Procedure

1. Pick a **blind baseline** — something with no real capability on the task:
   - a tiny/weak model, or
   - the target model but with the suspected leak channel removed from its
     context, or
   - a trivial heuristic (constant answer, or random over the label set).
2. Run the *same* eval with the *same* scoring on the baseline.
3. Compare to the expected floor:
   - For an N-way classification, chance ≈ 1/N (adjust for class imbalance).
   - For open-ended answers, a blind baseline should score near zero on a
     faithfulness/correctness judge.
4. Interpret:
   - Baseline near the floor → little or no leakage on the audited channel.
   - Baseline well above the floor → leakage. Find the channel (see
     leak-channels.md), sanitize, and repeat.

## Pairing it with sanitization

The strongest signal is a **before/after on the real model**:

- Real model on raw context: high score.
- Real model on sanitized context: meaningfully lower score.
- Blind baseline on sanitized context: near the floor.

If the real model's score does *not* drop after sanitization, either there was
no leak on that channel, or you missed a channel — check the others before
concluding the model is genuinely capable.

## Helper

`summarizeBlindBaseline(results, { suspiciousPassRate })` in
`scripts/leak_scan.ts` aggregates a blind-baseline run:

```ts
const summary = summarizeBlindBaseline(
  items.map((it) => ({ passed: scoreBlind(it) >= threshold })),
  { suspiciousPassRate: 0.5 }, // for ~4-way labels, chance ≈ 0.25
);
if (summary.suspicious) {
  // pass rate is too high for a blind baseline — audit for leakage
}
```

Pick `suspiciousPassRate` from the task's chance level, not a fixed number: it
is the ceiling you would tolerate from something with no real capability.
