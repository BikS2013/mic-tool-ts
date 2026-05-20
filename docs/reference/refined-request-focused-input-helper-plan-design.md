# Refined Request: Focused Input Helper Plan And Design

## Category

Documentation / Design

## Objective

Create a project plan and design document that describe how to implement the recommended focused-control text delivery approach: a macOS-native Swift helper invoked by `mic-tool-ts` to deliver processed transcript text through direct Accessibility insertion, Unicode keyboard-event typing, and clipboard-preserving key-code paste fallback.

## Scope

In scope:

- Produce an implementation plan under `docs/design/` using the project plan naming convention.
- Produce a focused design document under `docs/design/` describing components, deployment, communication, permissions, failure handling, testing, and rollout.
- Update the canonical project design and project functions documents so the planned architecture is discoverable from the main design corpus.
- Base the design on `docs/reference/investigation-focused-control-text-delivery.md`.

Out of scope:

- Implementing production Swift or TypeScript code.
- Adding or changing package dependencies.
- Changing the current runtime behavior of the focused-input operator.
- Running mutating focused-control proof-of-concept commands against active applications.

## Requirements

- The plan must identify implementation phases, files/modules expected to change, verification steps, and acceptance criteria.
- The design must answer:
  - Which components must be implemented.
  - How each component is deployed.
  - How components communicate with each other.
  - How permissions and diagnostics are handled.
  - How transcript privacy is protected.
- The design must keep `mic-tool-ts` as the supported user-facing invocation.
- The helper must be described as a user-level macOS assistive helper, not a privileged system daemon.
- The helper must read transcript text from stdin, not command-line arguments.
- The plan must include manual compatibility checks for representative macOS targets.

## Constraints

- Existing project rules remain in force: no hidden configuration fallbacks, no unnecessary transcript persistence, and no undocumented user-facing development invocations.
- The current project is TypeScript-first, but the helper may be Swift because the required APIs are native macOS frameworks.
- The plan/design must not claim that direct Accessibility insertion is universal.
- The current `pbcopy` plus System Events path remains the implemented behavior until a later implementation task changes production code.

## Acceptance Criteria

- `docs/design/plan-014-focused-input-helper.md` exists and links to the refined request and investigation.
- `docs/design/focused-input-helper-design.md` exists and describes components, deployment, communication, permissions, failure handling, and testing.
- `docs/design/project-design.md` references the planned focused-input helper architecture.
- `docs/design/project-functions.md` registers the planned focused-input helper requirements.
- No production source code is changed as part of this documentation task.

## Assumptions

- The implementation target is macOS.
- Swift is acceptable for the helper if it remains internal to the project and is invoked by the TypeScript orchestration layer.
- Short-lived helper process startup latency is acceptable until measurements prove otherwise.
- Accessibility permission will be required and must be surfaced explicitly.

## Open Questions

- Should clipboard preservation be mandatory for the first implementation or only for fallback paste mode?
- Should the helper be built with plain `swiftc` inside the existing package build or managed as a Swift Package target?
- Which exact applications should define the release-blocking manual compatibility matrix?

## Original Request

> I want you to create a plan and a design document to describe how to approach & proceed 
> to the implementation of this approach
