# Leak channels

The four channels through which a ground-truth answer reaches the model for
free. Audit every surface the model sees (input fields, retrieved context,
tool/observation outputs, upstream-stage outputs) against all four.

Running example (synthetic): an eval claims to measure whether a model can
**derive a ticket's `priority`** from its content. The model calls a
`get_ticket` tool that returns the ticket object.

## 1. Direct

The target value itself is present.

- Example: the returned ticket object includes `priority: "High"`, or the
  description contains the line `Priority: High`.
- Detection: search every surface for the expected value, verbatim and
  normalized (case/whitespace/punctuation insensitive). For short, atomic
  answers (labels, sizes like `S`/`M`/`L`), match on whole tokens to avoid
  false positives (`M` must not match inside `Medium`).

## 2. Correlated / derived

A *different* field that is set together with the target, or derived from it,
and implies it.

- Example: an `sla` field of `P1` that the team always sets alongside
  `priority: High`; or a segment field that co-varies with the target.
- Detection: enumerate the fields that co-occur with the target in your data,
  then scan for those values too. This channel is domain knowledge — list the
  correlated values explicitly and pass them to the scanner.

## 3. Upstream output

A prediction from an earlier pipeline stage, included in the context.

- Example: a separate classifier already wrote `aiCategory: "Billing/High"`
  onto the record, and the ticket object still carries it.
- Detection: trace the provenance of every field in the context. Anything
  produced by a model (yours or a third party's) is suspect — it may encode the
  target even if the raw answer string is absent.

## 4. Free-text mention

The answer stated in prose — across *every* format the content exists in.

- Example: a comment says "we agreed this is high priority"; a markdown table
  row holds the value; the rich-text/ADF tree still contains it after the
  plain-text view was cleaned.
- Detection: scan plain text **and** the structured representation. Redacting
  the markdown string but leaving the parsed tree intact is a classic miss.
  Redact at sentence granularity, not the whole field.

## Why "strongly implies" matters

Leakage is not only verbatim copies. A value that lets the model *shortcut* the
reasoning — a correlated label, an upstream prediction, a paraphrase — inflates
the score just as much as the literal answer. When in doubt, ask: "could a model
that cannot do the real task still get this right from what it sees?" If yes, it
is a leak.
