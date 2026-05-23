# User-Level Agent Instructions

These instructions are adapted from `~/.claude/claude.md` for Codex and other agents that read `AGENTS.md`.

**Important:** Always ensure that the beginning of each project's `AGENTS.md` file contains a copy of the "Structure & Conventions" chapter from this user-level `AGENTS.md`, and that the copy stays in sync with the current version.

<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the `test_scripts` folder. If the folder doesn't exist, you must make it.

- All plans must be kept under the `docs/design` folder inside the project's folder in separate files. Each plan file must be named according to the following pattern: `plan-xxx-<indicative description>.md`.

- The complete project design must be maintained inside a file named `docs/design/project-design.md` under the project's folder. The file must be updated with each new design or design change.

- All reference material used for the project must be collected and kept under the `docs/reference` folder.

- All functional requirements and all feature descriptions must be registered in the `/docs/design/project-functions.MD` document under the project's folder.

- At the beginning of every user request, examine whether the request needs refinement before implementation. A request needs refinement when it is broad, ambiguous, missing acceptance criteria, missing scope boundaries, risky, or likely to require material design decisions.

- If a request needs refinement, use the available `request-refiner` workflow, skill, or agent before doing any other project work. Store the refined request under `docs/design` using the filename pattern `request-xxx-<indicative-description>.md`. If the refined output is an implementation plan, store it as a plan instead using the required `plan-xxx-<indicative-description>.md` pattern.

- Each refined request document must capture the original request, the refined objective, scope, requirements, constraints, acceptance criteria, assumptions, and open questions. If the refinement leaves blocking questions, ask the user before implementation.

- After the request-refinement check, examine whether the request needs internet, external, or up-to-date research. If so, use the available `investigator` workflow, skill, or agent to collect the information needed before implementation.

- All internet or external research collected for a request must be stored under `docs/reference` using the filename pattern `investigation-xxx-<indicative-description>.md`. Include the source URLs, access date, key findings, and any implementation decisions or constraints derived from the research.

<configuration-guide>
- If the user asks you to create a configuration guide, you must create it under the `docs/design` folder, name it `configuration-guide.md`, and be sure to explain the following:
  - If multiple configuration options exist, such as config file, environment variables, CLI parameters, etc., explain the options and the priority of each one.
  - The purpose and use of each configuration variable.
  - How the user can obtain each configuration variable.
  - The recommended approach for storing or managing each configuration variable.
  - Which options exist for the variable and what each option means for the project.
  - If there is any default value for the parameter, present it.
  - For configuration parameters that expire, such as PAT keys or tokens, propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt while working in a project, the prompt must be placed inside a dedicated folder named `prompts`. If the folder doesn't exist, you must create it. The prompt file name must have a sequential number prefix and must be representative of the prompt's use and purpose.

- You must maintain a document at the root level of the project named `Issues - Pending Items.md`, where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.

- The `Issues - Pending Items.md` content must be organized with the pending items on top and the completed items after. From the pending items, the most critical and important must be first, followed by the rest.

- When the user asks you to create tools in the context of a project, everything must be in TypeScript.

- **Tool creation must follow the project tool conventions.** Prefer the available `tool-doc-config-architect` workflow or skill when available. If a project provides `/tool-conventions scaffold <tool-name>`, use it instead of scaffolding tool documentation or `~/.tool-agents/<tool-name>/` configuration folders by hand. The tool convention owner defines the full specification: the documentation file format, the `<toolName>` XML block under `docs/tools/<tool-name>.md`, the configuration folder structure and modes (`~/.tool-agents/<tool-name>/` at `0700`, `.env` at `0600`), the four-tier environment-variable resolution chain (shell env -> `~/.tool-agents/<name>/.env` -> local `.env` -> CLI flags, lowest to highest priority), the vendor-canonical LLM provider environment variable names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_OPENAI_*`, `AZURE_AI_INFERENCE_*`, `OLLAMA_HOST`, `LITELLM_*`), and the required set of eight standard LLM providers every LLM-enabled tool must support out of the box. For existing tools, use the available audit workflow, such as `/tool-conventions audit <tool-name>` when present, to verify conformance against the same specification.

- The project's `AGENTS.md` file must not contain the full tool documentation. Instead, it must contain a "Tools" section with a concise reference entry for each tool that includes:
  - The tool's name.
  - A high-level description of what the tool is capable of, in one or two sentences.
  - The relative path to the tool's dedicated documentation file, such as `docs/tools/<tool-name>.md`, so the agent can retrieve the full documentation any time it is needed.

- The tool-scaffolding workflow should produce the recommended entry text after each scaffold for the user to review and apply.

- Every time the user asks you to do something that requires the creation of a code script, examine the tools already implemented in the scope of the project by consulting the "Tools" section of the project's `AGENTS.md` and the corresponding documentation files under `docs/tools/`, to detect if the code you plan to write fits the scope of an existing tool.

- If so, implement the code as an extension of the tool. Otherwise, build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.

- The goal is, while the project progresses, to develop the tools needed to test, evaluate, generate data, collect information, etc., and reuse them in a consistent manner.

- All these tools must be referenced inside the project's `AGENTS.md`, with their dedicated documentation files under `docs/tools/`, to allow consistent reuse.

- When the user asks you to locate code, give the folder, the file name, the class, and the line number together with the code extract.

- Don't perform any version control operation unless the user explicitly requests it.

- When you design databases, align with the following table naming conventions:
  - Table names must be singular. For example, the table that keeps customers' data must be called `Customer`.
  - Tables that are used to express references from one entity to another can be plural if the first entity is linked to many other entities.
  - For example, use `Customer` and `Transaction` tables, and use `CustomerTransactions` for the relationship table.

- You must never create fallback solutions for configuration settings. In every case where a configuration setting is not provided, raise the appropriate exception. You must never substitute the missing config value with a default or fallback value.

- If the user asks you to make an exception to the configuration setting rule, write this exception in the project's memory or instructions file before you implement it.

- Every time you are asked to solve an issue, resolve it and thoroughly document both the issue and the solution.

<dependency-vetting>
- Before adding any new runtime dependency to a project (`package.json`, `pyproject.toml`, `go.mod`, etc.), you must verify the version you are about to pin is free of known security advisories. Apply this rule especially to:
  - **Browser/embedded-engine packages:** `electron`, `puppeteer`, `playwright`, `chromium`, `webview2`; they ship with full browser engines and accumulate CVEs fast.
  - **Test/build toolchains:** `vitest`, `vite`, `esbuild`, `webpack`, `rollup`, `parcel`; frequent dev-server RCE advisories with transitive impact.
  - **Network/proxy libraries:** `node-http-proxy`, `http-proxy-3`, `proxy-chain`, `axios`, `node-fetch`, `request`, `got`, `undici`.
  - **Cryptography/auth libraries:** `jsonwebtoken`, `jose`, `bcrypt`, `node-forge`, `crypto-js`.

- Vetting procedure, run before writing the dependency into the manifest:
  1. Identify the latest stable major version available on the registry, for example `npm view <pkg> versions --json | tail -10` or `pnpm info <pkg> versions --json`.
  2. Check the package's security advisory page, such as GitHub Advisory Database, npmjs.com vulnerability tab, or `npm audit --package <pkg>@<version> --json`, for the candidate version.
  3. If the candidate version has unfixed advisories at HIGH severity or above, bump to the next non-vulnerable major. If no such version exists, surface the trade-off to the user before proceeding.
  4. Pin to a caret range against the verified clean version, such as `"electron": "^39.8.5"`, not `"electron": "^38"`.
  5. Record the vetted-on date in a one-line comment in `Issues - Pending Items.md` under a "Dependency vetting log" section so future audits can date the decision.

- For especially fast-moving packages (`electron`, `vite`, `vitest`, `esbuild`), always pull the latest stable major even when a reference implementation uses an older one. The reference's version is informational, not authoritative; verify it is still on a supported branch before adopting it verbatim.

- After installing, always run the project's audit command (`pnpm audit`, `npm audit`, `pip-audit`, `cargo audit`, `go list -m -u -json all | nancy sleuth`, etc.) and confirm the advisory count is zero before marking the scaffolding step complete. Treat any HIGH-or-above advisory as a blocker and surface it before continuing.

- When a transitive dependency carries an advisory that the direct dependency has not yet fixed, such as `vitest@1` pulling `vite@5` with a CVE, use the package manager's override mechanism (`pnpm.overrides`, `npm overrides`, `yarn resolutions`, `cargo [patch]`) to force the fixed transitive version, and document the override in `Issues - Pending Items.md` with its expiry condition, such as "remove this override once direct-dep X reaches version Y".
</dependency-vetting>

</structure-and-conventions>

## Project Tool Invocation

- The project/tool name is `untype`.
- The supported user-facing invocation is the direct OS command `untype` on the user's `PATH`.
- Do not document or recommend `node dist/index.js`, `tsx src/index.ts`, `pnpm run dev`, or package-manager scripts as the installed-tool invocation. Those are development conveniences only.
- The per-user configuration folder is `~/.tool-agents/untype/`; the secrets file is `~/.tool-agents/untype/.env`.

## Tools

- `untype` — TypeScript CLI that captures macOS microphone audio, streams it to a realtime STT provider, and supports a voice-agent protocol for refinement, translation, clipboard copy, focused-input delivery, and JSONL agent events. Tool reference: `docs/tools/untype.md`.
