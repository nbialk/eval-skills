# AGENTS.md

## What this repo is

A **content repository** of Agent Skills for LLM evaluation engineering. The
deliverable is Markdown `SKILL.md` files (plus their helper scripts), not a
compiled application. There is no app, server, or build pipeline.

## Layout — know which dirs are the product vs. local tooling

- `skills/<skill-name>/` — **the product.** Each skill is a directory with a
  `SKILL.md` (YAML frontmatter: `name`, `description`) and optional
  `references/` and `scripts/`. This is what gets committed and released.
- `.opencode/` and `skills-lock.json` — **gitignored** (see `.gitignore`).
  These are *locally installed* third-party skills (e.g. `langfuse`,
  `skill-creator`) and the OpenCode plugin dep. Do **not** treat them as part
  of this repo's source, do not edit them as if they were owned here, and do
  not commit them.

## Commands

There is **no** build / test / lint / typecheck toolchain — no root
`package.json`, no tsconfig, no eslint/biome, no CI. Do not invent a
`npm test` / `npm run build`; they don't exist.

- Run a skill's TypeScript helper directly with tsx, from the skill dir:
  `npx tsx scripts/leak_scan.ts` (zero-dependency; also serves as its
  self-check/demo).
- "Verifying" a skill change = re-read the `SKILL.md` for correctness and run
  any bundled script's self-check. Match each script's documented run command
  inside its `SKILL.md`.

## Conventions

- Conventional Commits (`<type>(<scope>): <subject>`).
- Releases: add a `CHANGELOG.md` entry **before** tagging; tags are
  `v`-prefixed semver (e.g. `v0.1.0`).
- SKILL.md authoring: keep the frontmatter `description` action-oriented and
  trigger-rich (it's how the skill gets selected). The existing
  `skills/leak-audit/SKILL.md` is the reference for tone/structure: tight
  workflow steps, a quick-reference list, explicit anti-patterns, and a section
  per bundled script.
- All prose/code artifacts in English.
