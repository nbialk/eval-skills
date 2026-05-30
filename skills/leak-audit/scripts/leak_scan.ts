/**
 * leak_scan — zero-dependency helpers to detect ground-truth leakage in eval
 * datasets: places where the model under evaluation can see the expected answer
 * (or a value that strongly implies it), inflating scores.
 *
 * Detector, not a universal sanitizer: it finds leaks and helps verify the
 * score drop after you sanitize. What counts as a "correlated" leak is
 * task-specific — supply those values via `correlatedValues`.
 *
 * Channel coverage: this scanner mechanically covers the *direct* and
 * *correlated* channels (see references/leak-channels.md). The other two —
 * *upstream output* and *free-text mention* — are not purely mechanical:
 * upstream is a provenance question (is a field produced by a model?), and
 * free-text mention requires walking every format the content exists in. Drive
 * those from the channel checklist in SKILL.md, not from this `LeakChannel` type.
 *
 * Run the self-check / usage demo:
 *   npx tsx scripts/leak_scan.ts
 */

export type LeakChannel = "direct" | "correlated";

export interface LeakFinding {
  /** Which channel matched. `direct` = the expected answer itself appeared. */
  channel: LeakChannel;
  /**
   * `low` is reserved for a bare single-token match in free text (e.g. an
   * atomic answer like `S`/`M`/`L` appearing as a standalone word in prose):
   * surface it for review, do not fail the item automatically. The same token
   * matched inside a structured field stays `high`. See
   * references/validating-the-harness.md.
   */
  severity: "high" | "medium" | "low";
  /** Where it was found: "context" or a dotted/bracketed field path. */
  location: string;
  /** How it matched (token / verbatim phrase / normalized phrase). */
  detail: string;
}

export interface LeakScanOptions {
  /**
   * Values that imply the expected answer even when the answer text is absent
   * (correlated/derived fields, upstream model outputs). Domain-specific.
   */
  correlatedValues?: string[];
  /** Override normalization. Default: lowercase, punctuation -> space, collapse. */
  normalize?: (input: string) => string;
}

export interface AuditItemInput extends LeakScanOptions {
  /** The ground-truth answer the eval expects. */
  expected: string;
  /** Everything the model can see, flattened to a single string. */
  contextSeenByModel?: string;
  /** Structured object the model saw (walked recursively, paths reported). */
  fields?: unknown;
}

export interface LeakScanResult {
  /**
   * True when at least one `high`/`medium` finding fires. Bare single-token
   * matches in free text (`low`) do *not* set this — they are surfaced in
   * `findings` for review but never auto-fail an item (see `review`).
   */
  leaked: boolean;
  /** Low-confidence findings to surface for manual review, never auto-fail. */
  review: LeakFinding[];
  findings: LeakFinding[];
}

const DEFAULT_NORMALIZE = (input: string): string =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

interface TextMatch {
  detail: string;
  /** True when the match was a single whole token (no surrounding phrase). */
  bareToken: boolean;
}

/**
 * Match a single `needle` against a `haystack`. Single-token needles match on
 * whole tokens (so "M" does not match inside "Medium"); multi-token needles
 * match as a verbatim or normalized substring (phrase).
 */
function matchText(
  needle: string,
  haystack: string,
  normalize: (s: string) => string,
): TextMatch | null {
  if (!needle || !haystack) return null;

  const n = normalize(needle);
  const h = normalize(haystack);
  if (!n || !h) return null;

  const needleTokens = n.split(" ").filter(Boolean);
  if (needleTokens.length === 1) {
    return h.split(" ").includes(needleTokens[0])
      ? { detail: `token "${needleTokens[0]}"`, bareToken: true }
      : null;
  }
  if (haystack.includes(needle)) {
    return { detail: `verbatim phrase "${needle}"`, bareToken: false };
  }
  return h.includes(n)
    ? { detail: `normalized phrase "${n}"`, bareToken: false }
    : null;
}

/**
 * Scan a single text blob for direct + correlated leakage.
 *
 * `surface` controls severity for atomic answers: a bare single-token match in
 * free text (`surface: "freetext"`) is downgraded to `low` (surface for review,
 * do not auto-fail); the same match in a structured field (`surface: "field"`,
 * the default) stays `high`, because there the value is unambiguous.
 */
export function scanText(
  expected: string,
  text: string,
  options: LeakScanOptions = {},
  location = "context",
  surface: "field" | "freetext" = "field",
): LeakFinding[] {
  const normalize = options.normalize ?? DEFAULT_NORMALIZE;
  const findings: LeakFinding[] = [];

  const direct = matchText(expected, text, normalize);
  if (direct) {
    const lowConfidence = surface === "freetext" && direct.bareToken;
    findings.push({
      channel: "direct",
      severity: lowConfidence ? "low" : "high",
      location,
      detail: direct.detail,
    });
  }
  for (const value of options.correlatedValues ?? []) {
    const hit = matchText(value, text, normalize);
    if (hit) {
      findings.push({
        channel: "correlated",
        severity: "medium",
        location,
        detail: `${hit.detail} (correlated value)`,
      });
    }
  }
  return findings;
}

/** Recursively scan a structured object; reports the JSON path of each leaf. */
export function scanFields(
  expected: string,
  fields: unknown,
  options: LeakScanOptions = {},
): LeakFinding[] {
  const findings: LeakFinding[] = [];

  const walk = (node: unknown, path: string): void => {
    if (node == null) return;
    if (
      typeof node === "string" ||
      typeof node === "number" ||
      typeof node === "boolean"
    ) {
      findings.push(...scanText(expected, String(node), options, path || "fields"));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(fields, "");
  return findings;
}

/** Audit one eval item across the context string and structured fields. */
export function auditItem(input: AuditItemInput): LeakScanResult {
  const { expected, contextSeenByModel, fields, ...options } = input;
  const findings: LeakFinding[] = [];
  if (contextSeenByModel) {
    findings.push(
      ...scanText(expected, contextSeenByModel, options, "context", "freetext"),
    );
  }
  if (fields !== undefined) {
    findings.push(...scanFields(expected, fields, options));
  }
  const review = findings.filter((f) => f.severity === "low");
  const blocking = findings.filter((f) => f.severity !== "low");
  return { leaked: blocking.length > 0, review, findings };
}

export interface BlindBaselineSummary {
  n: number;
  passRate: number;
  suspicious: boolean;
}

/**
 * Aggregate a blind-baseline run. A baseline with no real capability should
 * score near chance; a pass rate above `suspiciousPassRate` signals leakage.
 */
export function summarizeBlindBaseline(
  results: Array<{ passed: boolean }>,
  options: { suspiciousPassRate?: number } = {},
): BlindBaselineSummary {
  const n = results.length;
  const passed = results.filter((r) => r.passed).length;
  const passRate = n === 0 ? 0 : passed / n;
  const threshold = options.suspiciousPassRate ?? 0.5;
  return { n, passRate, suspicious: passRate > threshold };
}

// ---------------------------------------------------------------------------
// Self-check / usage demo (runs only when executed directly).
// ---------------------------------------------------------------------------

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function runDemo(): void {
  // A) Atomic answer ("High" is one token) appearing in *free text*: a
  //    low-confidence review item, NOT an auto-fail. See validating-the-harness.md.
  const leaky = auditItem({
    expected: "High",
    contextSeenByModel: "Summary: login broken\nPriority: High\nReporter: a@b.c",
  });
  check("A not auto-failed", leaky.leaked, false);
  check("A surfaced for review", leaky.review.length, 1);
  check("A review severity", leaky.review[0]?.severity, "low");

  // A2) A multi-token phrase in free text is unambiguous → still a blocking leak.
  const phrase = auditItem({
    expected: "Billing issue",
    contextSeenByModel: "Notes: this is clearly a Billing issue, route to finance.",
  });
  check("A2 leaked", phrase.leaked, true);
  check("A2 channel", phrase.findings[0]?.channel, "direct");

  // B) Sanitized context — no leak.
  const clean = auditItem({
    expected: "High",
    contextSeenByModel: "Summary: login broken\nReporter: a@b.c",
  });
  check("B clean", clean.leaked, false);

  // C) Leak inside a nested structured field — path is reported.
  const nested = auditItem({
    expected: "High",
    fields: { fields: { summary: "login broken", priority: "High" } },
  });
  check("C leaked", nested.leaked, true);
  check("C location", nested.findings[0]?.location, "fields.priority");

  // D) Correlated value implies the answer even though "High" is absent.
  const correlated = auditItem({
    expected: "High",
    contextSeenByModel: "Summary: login broken\nSLA: P1",
    correlatedValues: ["P1"],
  });
  check("D leaked", correlated.leaked, true);
  check("D channel", correlated.findings[0]?.channel, "correlated");

  // E) Whole-token matching avoids false positives (size "M" vs. "Medium").
  const noFalsePositive = auditItem({
    expected: "M",
    contextSeenByModel: "The Medium article explains the management process.",
  });
  check("E no false positive", noFalsePositive.leaked, false);

  // F) Blind baseline that scores too high for ~4-way labels (chance ~ 0.25).
  const summary = summarizeBlindBaseline(
    [{ passed: true }, { passed: true }, { passed: false }, { passed: true }],
    { suspiciousPassRate: 0.5 },
  );
  check("F passRate", summary.passRate, 0.75);
  check("F suspicious", summary.suspicious, true);

  console.log("leak_scan self-check: all assertions passed");
  console.log("  A review (low)   :", leaky.review[0]);
  console.log("  A2 phrase/direct :", phrase.findings[0]);
  console.log("  C nested field   :", nested.findings[0]);
  console.log("  D correlated     :", correlated.findings[0]);
  console.log("  F blind baseline :", summary);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  Boolean(process.argv[1] && process.argv[1].endsWith("leak_scan.ts"));

if (invokedDirectly) {
  try {
    runDemo();
  } catch (err: unknown) {
    console.error(err);
    process.exit(1);
  }
}
