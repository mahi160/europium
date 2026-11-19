# Issue tracker: Local Markdown

Issues and specs live in `.scratch/`, grouped by feature.

## Conventions

- Specs: `.scratch/<feature-slug>/spec.md`.
- Tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`.
- Use one file per ticket, numbered from `01` in dependency order.
- Record triage state near the top as `**Status:** <label>`.
- Record blocking tickets as `**Blocked by:** <numbers and titles>`.
- Use the labels defined in `triage-labels.md`.
- Append discussion under a `## Comments` heading.

## Operations

To publish a ticket, create its individual Markdown file.
To fetch a ticket, read the referenced file.
Start implementation only when all listed blockers are complete.
