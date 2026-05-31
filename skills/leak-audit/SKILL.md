---
name: leak-audit
description: >-
  Detect and close ground-truth leakage in LLM eval datasets — cases where the
  model under evaluation can see material that contains or strongly implies the
  expected answer, so eval scores are inflated and no longer reflect real
  capability. Use when building, reviewing, or debugging an eval/benchmark
  dataset (especially for RAG or tool-using/agentic systems), when eval scores
  look suspiciously high, when a weak or blind baseline still passes, or when
  deciding whether retrieved context, tool/observation outputs, dataset fields,
  or upstream-stage outputs leak the target answer.
---

# Leak Audit

Ground-truth leakage = the model under evaluation can see material that
contains or strongly implies the expected answer. The eval then measures
*reading*, not *capability*, and scores look great while telling you nothing.
It is most common in RAG and tool-using/agentic evals, where the model fetches
its own context and the answer rides along inside it.

## Workflow

Run these steps in order. Do not skip the smoke test — it is the cheap proof.

1. **Name the target.** State the single thing the eval claims to measure
   ("derive X from the content"). Anything that hands X to the model for free
   is a leak.
2. **Enumerate what the model actually sees.** Not just the prompt:
   dataset/input fields, retrieved/RAG context, tool & observation outputs, and
   the outputs of any upstream pipeline stage. List each surface.
3. **Audit each surface against the leak channels.** See
   [references/leak-channels.md](references/leak-channels.md) for the four
   channels and detection hints. Use `scripts/leak_scan.ts` to scan
   programmatically.
4. **Confirm with a blind-baseline smoke test.** A baseline that *cannot* do
   the real task should score near chance. If it scores high, you are leaking.
   See [references/smoke-test.md](references/smoke-test.md) for the method and
   [references/blind-baseline-runner.md](references/blind-baseline-runner.md)
   for the concrete dual-run recipe (run the real pipeline twice, raw vs
   sanitized, and read the leak off the score gap). **Before trusting the
   numbers**, confirm the run actually exercised the channel (the tool was
   called and returned real data) — see
   [references/validating-the-harness.md](references/validating-the-harness.md).
5. **Close the leaks** by sanitizing the leaking surface — without changing
   what the model can tell it is looking at (see Sanitization rules).
6. **Verify.** Re-run the smoke test. A correctly fixed eval shows a
   *meaningful score drop*. If the blind baseline still passes, you missed a
   channel — return to step 3.

## Leak channels (quick reference)

Audit every surface for all four. Details and examples in
[references/leak-channels.md](references/leak-channels.md).

- **Direct** — the target value itself is present (the answer field).
- **Correlated/derived** — a different field set together with the target, or
  computed from it, that implies it.
- **Upstream output** — an earlier stage's prediction (e.g. a prior classifier)
  included in the context.
- **Free-text mention** — the answer stated in prose, across *all* formats:
  plain text, markdown tables, nested rich-text/JSON trees, comments.

## Sanitization rules

- **Preserve the observation signature.** Keep tool name, description, and
  output schema identical; only blank/redact values. Changing the shape changes
  the behavior you are trying to measure.
- **Redact the span, not the document.** Drop the leaking sentence/field, keep
  everything else — you still want to test reasoning over the real content.
- **Walk every format.** Plain text *and* the structured/nested representation
  of the same content (e.g. a markdown body and its parsed rich-text tree).
- **Emit redaction stats.** Record what was stripped per item so the
  sanitization is auditable and reviewable.

## Anti-patterns

- Changing the tool/observation name or schema while sanitizing.
- Blanking the whole document instead of the leaking span.
- Auditing only the prompt, or only plain text — missing retrieved context,
  tool/upstream outputs, and nested/structured formats.
- Exact-string-only matching; missing case/whitespace/punctuation variants and
  correlated values.
- Skipping the verification re-run (never confirming the score actually drops).
- Two failure modes that both masquerade as "no leak" — trusting a
  blind-baseline score without confirming the channel was exercised, and
  flagging a bare single-token answer in prose as a direct leak. Both are
  covered in
  [references/validating-the-harness.md](references/validating-the-harness.md).

## scripts/leak_scan.ts

Zero-dependency TypeScript helpers (run with `tsx`, import into any eval
framework):

- `auditItem({ expected, contextSeenByModel, fields?, correlatedValues? })`
  → `{ leaked, review[], findings[] }`. Scans a flat context string and a
  structured fields object (recursively, with JSON paths) for direct and
  correlated leakage. `leaked` fires only on blocking (`high`/`medium`)
  findings; low-confidence matches go to `review[]` instead of auto-failing
  (atomic-answer handling:
  [references/validating-the-harness.md](references/validating-the-harness.md#atomic-answers-cause-scanner-false-positives)).
- `scanText(expected, text, options?, location?, surface?)` /
  `scanFields(expected, fields, options?)` — the underlying scanners. Pass
  `surface: "freetext"` to `scanText` to enable the atomic-answer downgrade.
- `summarizeBlindBaseline(results, { suspiciousPassRate })` — aggregates a
  blind-baseline run and flags a suspiciously high pass rate.

The scanner mechanically covers only the **direct** and **correlated** channels.
The **upstream-output** and **free-text-mention** channels are not purely
mechanical (provenance, and walking every format) — drive those from the channel
checklist above, not from the scanner. The runner examples in
[references/blind-baseline-runner.md](references/blind-baseline-runner.md) call
helpers like `projectSurfaces` / `correlatedValuesFor`: those are illustrative —
you write them for your domain; they are not part of `leak_scan.ts`.

Run the built-in self-check / usage demo:

```bash
npx tsx scripts/leak_scan.ts
```

`leak_scan` is a *detector*, not a universal sanitizer: what counts as a leak
(especially the correlated channel) is task-specific. Use it to find leaks and
to verify the score drop after you sanitize; drive the actual redaction from the
channel checklist above.
