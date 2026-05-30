# Blind-baseline runner (raw vs sanitized)

The concrete recipe behind the smoke test: run the *same* pipeline twice and
read the leak off the score gap. Two complementary tracks — a live model run
and a deterministic static scan — that corroborate each other.

## Contents

- [The dual-run pattern](#the-dual-run-pattern)
- [Track A — live blind baseline](#track-a--live-blind-baseline)
- [Track B — static raw-vs-sanitized scan](#track-b--static-raw-vs-sanitized-scan)
- [Reading the result](#reading-the-result)
- [Correlated values are task-specific](#correlated-values-are-task-specific)

## The dual-run pattern

One eval, two modes. The **only** difference between them is whether the
suspected leak channel's payload is delivered raw or sanitized. Everything else
— prompt, tool set, scoring — stays byte-for-byte identical.

Hard rule: **keep the observation signature identical.** Same tool name,
description, and input/output schema; only the *returned value* changes. If you
rename the tool or change its shape, you change the behaviour you are trying to
measure (the model may route differently), and the two runs are no longer
comparable.

The leak magnitude is the score gap:

```
leak_magnitude = score(raw) − score(sanitized)
```

A large gap means the model was reading the answer for free.

## Track A — live blind baseline

Toggle the channel with a flag so both modes share one code path:

```ts
import { summarizeBlindBaseline } from "../scripts/leak_scan";

// Same tool name / description / schema in both modes — only the returned
// value differs. `sanitizeRecord` redacts the leaking span(s); see
// leak-channels.md for what to redact.
function buildTools(sanitize: boolean): ToolSet {
  return {
    lookup: tool({
      description: "Fetch the record for an id.", // identical in both modes
      inputSchema: lookupSchema, // identical in both modes
      execute: async (args) => {
        const record = await fetchRecord(args); // real datastore
        return sanitize ? sanitizeRecord(record) : record;
      },
    }),
  };
}

const sanitize = !process.argv.includes("--leak");

const results: Array<{ passed: boolean }> = [];
for (const item of dataset) {
  const out = await runPipeline({ item, tools: buildTools(sanitize) });
  results.push({ passed: score(out, item.expected) });
}

// Chance level, not a fixed number: 1/N for N-way labels.
const blind = summarizeBlindBaseline(results, { suspiciousPassRate: 1 / N });
```

Run it twice and compare:

```bash
my-eval --leak     # raw: leak channel intact (blind baseline)
my-eval            # sanitized control
```

Before trusting either number, confirm the run actually exercised the channel
(the tool was called and returned real data) — see
[validating-the-harness.md](validating-the-harness.md). A dead datastore or a
tool the model never calls produces a near-floor score in *both* modes that
looks like "no leak".

## Track B — static raw-vs-sanitized scan

Deterministic, no model calls, not subject to routing or flakiness. For each
item, scan the raw record and the sanitized record with the same scanner: raw
should leak, sanitized should be clean. Residual findings on the sanitized side
pinpoint a channel the sanitizer still leaves open.

`projectSurfaces`, `correlatedValuesFor`, and `sanitizeRecord` below are
**domain helpers you write**, not exports of `leak_scan.ts` — only `auditItem`
(and friends) come from the scanner.

```ts
import { auditItem } from "../scripts/leak_scan";

for (const item of dataset) {
  const raw = await fetchRecord(item.input);
  const correlated = correlatedValuesFor(raw); // domain knowledge

  // Project to the answer-bearing surfaces only. Scanning the whole record
  // adds single-token noise for atomic answers — see validating-the-harness.md.
  const rawScan = auditItem({
    expected: item.expected,
    fields: projectSurfaces(raw),
    correlatedValues: correlated,
  });
  const sanScan = auditItem({
    expected: item.expected,
    fields: projectSurfaces(sanitizeRecord(raw)),
    correlatedValues: correlated,
  });

  // Expect rawScan.leaked === true and sanScan.leaked === false.
  if (sanScan.leaked) reportResidual(item, sanScan.findings);
}
```

Emit per-item redaction/finding stats so the audit is reviewable: which channel
(direct/correlated) matched, where, and what was stripped.

## Reading the result

| Live: raw run        | Live: sanitized run     | Static: sanitized scan | Reading                                                                 |
| -------------------- | ----------------------- | ---------------------- | ----------------------------------------------------------------------- |
| high (≫ chance)      | near chance             | clean                  | Active leak; sanitizer closes it. The intended outcome.                 |
| high                 | still elevated          | clean                  | Real capability (or signal the sanitizer can't remove). Not a leak.     |
| high                 | still elevated          | residual findings      | A channel still leaks. Fix the sanitizer at the flagged surface, repeat.|
| near chance          | near chance             | raw also clean         | No leak on this path — **but** confirm the channel was exercised first. |

The live and static tracks check each other: if the live score stays elevated
after sanitizing, the static scan tells you whether that is residual leakage (a
surface the sanitizer missed) or genuine model capability.

## Correlated values are task-specific

`leak_scan` finds the direct channel on its own, but the correlated channel is
domain knowledge: enumerate the fields/values that co-occur with the target and
pass them as `correlatedValues`. A common residual leak is a correlated value
that the sanitizer nulls in a structured field but leaves mentioned in free-text
prose — walk every format (see leak-channels.md, channel 4).
