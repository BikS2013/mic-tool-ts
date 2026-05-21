# Refined Request: Project Design HTML With Mermaid Diagrams

## Category
Documentation

## Objective
Create an HTML version of the project's Markdown design document, converting the Markdown document's ASCII diagrams and diagram-like flows into Mermaid diagrams in the HTML output.

## Scope
- Source document: `docs/design/project-design.md`.
- Output document: `docs/design/project-design.html`.
- Convert diagrammatic ASCII/code blocks that represent architecture, control flow, lifecycle, normalization pipeline, or configuration priority into Mermaid.
- Preserve the rest of the document content, headings, tables, and code examples as HTML.
- Keep `docs/design/project-design.md` unchanged as the authoritative Markdown source.

Out of scope:
- Rewriting the technical design prose.
- Changing source code behavior.
- Adding runtime dependencies to `package.json`.
- Replacing non-diagram code examples with Mermaid.

## Requirements
- The generated HTML must be readable as a standalone design artifact.
- Mermaid diagrams must replace the relevant ASCII diagrams in the HTML version.
- TypeScript, JSON, text command examples, and other non-diagram code samples must remain code/preformatted blocks.
- The HTML must include enough styling for tables, code, and diagrams to be readable without relying on the Electron UI styles.
- The generated artifact must be placed under `docs/design`.

## Constraints
- Do not edit the source Markdown document unless a genuine documentation defect is discovered.
- Do not add a new npm dependency for Markdown conversion or Mermaid rendering.
- Use local tooling already available in the environment when possible.
- Preserve existing user changes and avoid version-control operations.

## Acceptance Criteria
- `docs/design/project-design.html` exists.
- The HTML title and main heading identify it as the `mic-tool-ts` technical design.
- The HTML includes Mermaid-renderable diagrams for:
  - audio data flow,
  - shutdown control flow,
  - normalization pipeline,
  - lifecycle/concurrency sequence,
  - configuration priority chain.
- The HTML contains Mermaid initialization code.
- No ASCII box-drawing versions of the converted diagrams remain in the HTML body.
- The HTML passes a lightweight sanity check for expected Mermaid blocks and key document text.

## Assumptions
- The requested "έκδοση HTML" should be a generated artifact named `docs/design/project-design.html`.
- Mermaid can be loaded in the HTML via CDN/module import when the file is opened in a browser with network access.
- The Markdown document remains the canonical editable source.

## Open Questions
None blocking.

## Original Request
Θέλω να δημιουργήσεις μια έκδοση HTML του εγγράφου σχεδιασμού του έργου σε markdown. Θέλω να μετατρέψεις τα ASCII σχέδια και διαγράμματα από το έγγραφο markdown σε διαγράμματα και σχέδια Mermaid στην έκδοση HTML.
