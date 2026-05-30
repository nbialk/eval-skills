# Validating the harness

A blind-baseline score is only meaningful if the pipeline **actually exercised
the leak channel**. The most common way to get fooled is a run that scores near
the floor for a reason that has nothing to do with capability or leakage — and
then concluding "no leak" (or "model can't do it") from a broken run.

## Contents

- [Precondition: confirm the channel was exercised](#precondition-confirm-the-channel-was-exercised)
- [Symptom to cause](#symptom-to-cause)
- [Atomic answers cause scanner false positives](#atomic-answers-cause-scanner-false-positives)
- [Correlated values hide in free text](#correlated-values-hide-in-free-text)

## Precondition: confirm the channel was exercised

Before interpreting any score (a drop, *or* a flat near-floor result), verify:

1. **The model actually called the tool / retrieval that carries the leak.**
   Check the tool-call count, not just the final answer. If the system prompt
   does not advertise the tool, the model may never call it — the channel is
   never exercised, and the score looks like "no leak" regardless of what the
   tool would have returned. Advertise the tool, or assert `toolCalls > 0`.
2. **The tool / datastore returned real data, not errors or empties.** A down
   datastore, an expired credential, or a failed retrieval makes every call
   return an error or empty result. The model then produces "no answer" across
   the board — at the score level this is indistinguishable from "the model is
   incapable". Check for tool errors / empty results before trusting the run.
3. **The same checks pass in the raw run.** The raw (leaked) run is your
   positive control: it *should* score well above chance. If it does not,
   something upstream is broken — fix the harness before drawing any conclusion
   about the sanitized run.

Treat the raw run as a smoke test for the harness itself: if the answer is
sitting in the tool output and the score is still near chance, the pipeline is
not delivering the tool output to the model.

## Symptom to cause

| Symptom                                                        | Likely cause                                              | Action                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Raw run near chance; tool-call count is 0                      | Model never calls the leak-bearing tool                   | Advertise the tool in the prompt; re-run. Fix the harness, not data. |
| Every item "no answer"; tool results are errors/empty          | Datastore/auth/retrieval down                             | Restore connectivity/creds; re-run. All prior numbers are invalid.|
| Raw and sanitized both near chance; tool *did* return real data | Leak genuinely not active via this path                   | Trust it — but cross-check the static scan for a latent channel.  |
| Raw high, sanitized still elevated                             | Residual channel OR real capability                       | Run the static raw-vs-sanitized scan to disambiguate.             |

The lesson: a near-floor blind baseline is *evidence of no leak only when the
harness is known-good*. Always validate the positive control first.

## Atomic answers cause scanner false positives

Single-token answers — labels (`yes`/`no`), sizes (`S`/`M`/`L`/`XL`), grades —
trip the direct-channel scanner even with whole-token matching: a bare `S`
appearing as a standalone token anywhere in prose is reported as a "direct"
leak, when it is just the letter.

Guidance for atomic answers:

- Scan the **direct channel on structured fields**, where the value is
  unambiguous (e.g. `fields.size == "L"`), rather than on free text.
- For free text, require **phrase context** (`Größe: L`, `priority is High`)
  rather than a bare token.
- Treat bare single-token matches as **low-confidence** — surface them for
  review instead of failing the item automatically.

This keeps the static scan's signal clean: real leaks (the structured field,
the phrase mention) stay flagged; incidental letters do not.

## Correlated values hide in free text

A frequent residual leak after sanitizing: the sanitizer nulls a correlated
field in the structured record (e.g. a user-segment or SLA field that co-varies
with the target) but the **same value is still mentioned in prose** — a comment,
a description, a rich-text node. The structured channel is closed; the free-text
one is not. Always re-scan plain text *and* the structured/nested representation
after sanitizing (leak-channels.md, channel 4), and pass the correlated values
as `correlatedValues` so the scanner catches their free-text mentions too.
