# Refined Request: Google LLM Provider From UI

## Category
Development / LLM provider integration.

## Objective
Fix the UI-started Google LLM path so selecting `google` as the LLM provider can run refinement and translation instead of failing at refiner construction.

## Scope
In scope:
- Implement the existing `google` LLM provider name through the Gemini REST `generateContent` API.
- Resolve `GOOGLE_API_KEY` through the existing env-chain when `--llm-provider=google` and LLM refinement is enabled.
- Keep the UI model field compatible with Google by defaulting to a Gemini model when the UI provider selector changes to `google`.
- Add focused config, factory, and provider tests.
- Update docs and pending-provider tracking.

Out of scope:
- Adding UI fields for LLM API keys or endpoints.
- Implementing Vertex AI authentication.
- Implementing the remaining six LLM providers.
- Changing protocol operator semantics.

## Requirements
- `createRefiner()` must return a real Google refiner for provider `google`.
- Google refinement must call Gemini `generateContent` with the configured system prompt and transcript text.
- Google refinement must parse text from `candidates[0].content.parts[].text`.
- Startup must require `GOOGLE_API_KEY` only when Google LLM refinement is enabled.
- The UI must not persist `GOOGLE_API_KEY`.
- Switching the UI provider selector to `google` must set a Google-compatible default model.

## Constraints
- Do not add a runtime SDK dependency; use Node 20 native `fetch`.
- Preserve timeout/disposal and fail-open runtime behavior.
- Preserve typed startup errors for missing required credentials.

## Acceptance Criteria
- Google provider config resolves with `GOOGLE_API_KEY`.
- Missing `GOOGLE_API_KEY` raises a typed LLM configuration error when Google refinement is enabled.
- Google refiner unit tests cover success and representative error mapping.
- `pnpm typecheck`, focused tests, full tests, `pnpm build`, and packaged UI verification pass.

## Assumptions
- The Google provider means Gemini Developer API key authentication, not Vertex AI OAuth.
- `gemini-3.5-flash` is an acceptable default model for the UI model field when choosing `google`.

## Open Questions
None.

## Original Request
> when i try the google model i get this


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
