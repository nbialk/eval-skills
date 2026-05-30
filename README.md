# eval-skills

Agent skills for evaluation engineering with LLMs.

Open-source collection of [Agent Skills](https://agentskills.io)
for evaluation engineering: building reliable LLM-as-judge pipelines, leak
audits, deterministic scoring, and related eval workflows.

## Available skills

- **[leak-audit](./skills/leak-audit/)** — detect and close ground-truth
  leakage in LLM eval datasets, where the model under evaluation can see
  material that contains or implies the expected answer and inflates scores.

## Structure

Each skill lives in its own directory under `skills/`:

```
skills/
  <skill-name>/
    SKILL.md
```

## Versioning

Semantic versioning with `v` prefix on git tags (e.g. `v0.1.0`).
Every release is documented in [CHANGELOG.md](./CHANGELOG.md) before the
tag is pushed.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

[MIT](./LICENSE)
