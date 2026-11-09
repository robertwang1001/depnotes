# Depnotes — Product & Engineering Backlog

> Baseline: **v0.15.0** (2026-11-10). A local-first, read-only JavaScript dependency upgrade reviewer with CLI, dashboard, version-range release notes, workspace support, user/project settings, themes, progressive SSE scans, and fixture-backed tests.
>
> This is a *prioritized backlog*, not a commitment to implement every idea. Items are unchecked until independently verified. **Do not mistake existing partial support for completed support.** Revisit priorities using user feedback and measured data.

## How to use this file

- **P0 — Correctness, security & release blockers:** fix before encouraging broad use or npm publishing.
- **P1 — Core usefulness & reliability:** next development milestones.
- **P2 — UX, integrations & maintainability:** implement after P0/P1 foundations.
- **P3 — Optional / experimental:** only when justified by demand.
- **Effort:** S = hours–1 day, M = a few days, L = multi-day/architectural. Estimates are relative, not deadlines.
- **Tags:** `bug`, `test`, `perf`, `core`, `security`, `ux`, `cli`, `docs`, `integration`, `future`.
- **Done means:** tests added or updated; documentation updated; errors and fallbacks explicit; no undocumented changes to user projects; `npm test`, `npm run test:e2e` and `npm pack --dry-run` pass in CI for user-facing functionality.

## Current implementation snapshot (verify before changing)

| Area | In v0.15 | Main limitation / question |
|---|---|---|
| CLI (`depnotes`, `list`, `check`, JSON) | Implemented | Distribution and CI contract not fully validated |
| Dashboard, Markdown, dark/light/system | Implemented | Accessibility and visual regression coverage incomplete |
| npm, pnpm, Yarn, Bun detection | Implemented | Mixed-manager conflicts and unusual roots |
| Lockfile direct-version readers | Partial | Yarn/Bun edge cases; aliases, catalogs, workspace links |
| Release-age rules (3-day Depnotes default) | Partial | Actual manager policy can differ; missing timestamps, strict mode |
| npm metadata and GitHub release notes | Implemented | Hardcoded public registry; incomplete changelog coverage |
| Progressive scan via SSE | Implemented | Browser reconnection, cancellation, overlap and E2E testing |
| User-level settings; optional project overrides | Implemented | Schema/versioning and complete manager config precedence |
| Deterministic fixtures, CI and benchmark harness | Implemented | Full green CI and meaningful live performance baselines not yet established |
| Applying updates | Not implemented | Deliberately read-only |

---

## P0 — Correctness, security & release blockers

### P0.1 Make tests green and trustworthy

- [ ] **[P0][M][test] Establish a reproducible dependency installation and green CI baseline.** Commit a lockfile for Depnotes; install with `npm ci` in CI; pin supported Node versions; record the complete `npm test` result. **Accept:** zero skipped/failed tests attributable to missing dependencies and a reproducible clean checkout.
- [ ] **[P0][M][test] Run Playwright end-to-end tests in CI and locally.** Exercise initial scan, streaming, selecting a dependency, formatted notes, settings persistence, theme changes and rescan. **Accept:** Chromium tests pass headlessly with isolated fixture data, no outbound registry/GitHub calls. Follow Playwright's `webServer`/CI guidance.
- [ ] **[P0][M][test] Regression-test SSE disconnect, reconnect, slow subscriber, late subscriber and competing rescans.** Validate replay ordering, duplicate suppression, disconnect cleanup and JSON fallback. **Accept:** no missing or duplicated rows, hanging promises or misleading completion state.
- [ ] **[P0][M][test] Run a cross-platform CLI smoke matrix (Windows, macOS, Linux).** Cover `npm link` symlinks, manual browser opening, Ctrl+C, port conflicts, paths with spaces/non-ASCII, and `--dir`. **Accept:** command never exits silently and reports actionable failures.
- [ ] **[P0][M][test] Build real-world lockfile fixture corpus.** Generate and commit sanitized lockfile fixtures from supported npm/pnpm/Yarn/Bun versions; include scoped packages, peer suffixes, overrides, aliases, prereleases, optional dependencies and monorepos. **Accept:** every exact baseline is corroborated by that manager's own lockfile interpretation; ambiguous entries stay labeled unknown.
- [ ] **[P0][S][test] Ensure simulated failures are deterministically injectable.** Test 404/429/5xx, timeouts, truncated bodies, malformed metadata, GitHub rate limits, missing publication dates, and nonexistent releases. **Accept:** no false “up-to-date” or “no repository” conclusions.

### P0.2 Correct dependency and update decisions

- [ ] **[P0][L][core] Audit and correct lockfile resolution for each manager.** Validate root vs workspace importers; Yarn Classic/Berry descriptors, modern Bun text lock, npm lockfile versions and pnpm snapshots. **Accept:** exact/estimated/unsupported baseline is accurate and separately visible for every row.
- [ ] **[P0][M][core] Distinguish “installed”, “locked”, “manifest minimum” and “requested range”.** The lockfile provides a *resolved* version, not proof of what is currently in `node_modules`. **Accept:** UI/JSON/CLI never call an estimated version installed; show provenance.
- [ ] **[P0][M][core] Correct SemVer selection and statuses.** Test nonstandard dist-tags, deprecated releases, prereleases, downgrades, invalid ranges, missing `latest`, stale or yanked releases, and non-SemVer sources. **Accept:** deterministic recommended target and a reason for unavailable/unsupported updates.
- [ ] **[P0][M][core] Make release-age semantics explicit.** Keep Depnotes' fallback of 4,320 minutes distinct from any package-manager defaults; support or clearly flag `minimumReleaseAgeStrict`, `minimumReleaseAgeIgnoreMissingTime`, version-scoped exclusions and other relevant rules. **Accept:** never imply that a recommendation is guaranteed installable by pnpm/npm/Yarn/Bun. See [pnpm settings](https://pnpm.io/settings).
- [ ] **[P0][M][core] Respect registry configuration.** Remove the fixed `https://registry.npmjs.org/` assumption; resolve the effective default/per-scope registry from supported project/user manager config, including mirrors. **Accept:** correct host for scoped/private packages; no credentials sent to the wrong host; unsupported authentication is explicit.
- [ ] **[P0][M][core] Handle rate limits and partial failures without suppressing valid results.** Per-package diagnostic reasons, retry-after, bounded retries, overall request deadlines and actionable missing-credentials messages. **Accept:** one bad package does not fail the whole scan; no misleading zero-updates result.

### P0.3 Local server and settings safety

- [ ] **[P0][M][security] Threat-model the loopback HTTP server and settings write APIs.** Verify bind to `127.0.0.1`, Host/Origin validation (including DNS rebinding), strict methods/content types/body limits, CSRF protections, file/path allowlist, and symlink escapes. **Accept:** malicious web pages cannot read project results or write config; remote machines cannot connect by default.
- [ ] **[P0][M][security] Sanitize untrusted Markdown and URLs.** Review markdown-it configuration, escaping, link schemes, GitHub content, rendered HTML insertion, CSP, HTML attributes and truncation. **Accept:** malicious release-note fixtures cannot execute scripts, load unexpected assets or inject local URLs.
- [ ] **[P0][M][security] Protect secrets and local metadata.** Redact tokens, auth headers, sensitive project paths and private registry responses from logs/export/diagnostics; avoid recording credentials in config. **Accept:** sanitization tests and documented data-flow boundaries.
- [ ] **[P0][S][bug] Review config persistence and precedence.** Ensure no writes on scan, explicit user/project scopes, atomic writes, permissions and clear invalid-config errors. **Accept:** reset/override behavior tested, other project files untouched.

---

## P1 — Make the primary workflow excellent

### P1.1 Release-note completeness and credibility

- [ ] **[P1][L][core] Improve source discovery beyond a single GitHub repository.** Handle `repository.directory`, GitLab/Bitbucket links where practical, scoped monorepo packages, changelog directories, Git tags, GitHub Releases and official migration docs. **Accept:** sources discovered with provenance, not inferred as authoritative without evidence.
- [ ] **[P1][L][core] Cover the *entire* from→to version interval.** Fetch/paginate enough releases, correlate tags with npm versions and extract per-package monorepo entries. **Accept:** skipped major/minor releases are listed, gaps explicitly identified.
- [ ] **[P1][M][core] Show a version-range coverage score/status with evidence.** Define e.g. `complete (verified)`, `partial`, `none`, `unknown`; display considered tags, missing versions, release-note source and reasons. **Accept:** no false “complete” claim based solely on a few release results.
- [ ] **[P1][M][core] Find and link targeted migration guides.** Look in known repository docs and official sites, but do not crawl arbitrary websites blindly. **Accept:** links are clickable, source-attributed, and scoped to affected major versions when possible.
- [ ] **[P1][M][ux] Group notes by release/version and show summary before full body.** Expand first available note by default, preserve accordion state, anchor headings, include timestamps and `view source`. **Accept:** large histories remain navigable and don't block main thread.
- [ ] **[P1][M][core] Detect major-version API removals and breaking headings with conservative heuristics.** Label findings as *possible* breaking changes unless directly sourced. **Accept:** source text/link attached to each flag; no AI-required functionality.
- [ ] **[P1][M][perf] Cache notes by exact package, repo, version interval and source freshness.** Use ETag/Last-Modified; bound memory and payload size. **Accept:** repeated reviews avoid duplicate network and parsing work without serving indefinitely stale content.

### P1.2 Scanning, performance and diagnostics

- [ ] **[P1][M][perf] Benchmark representative *real* workspaces.** Small/medium/large direct-dependency sets across all four managers; record cold/warm times, time to first result, request counts, memory, UI responsiveness and cache hit rates. **Accept:** reproducible baseline with hardware/network details; synthetic benchmark clearly labeled.
- [ ] **[P1][M][perf] Stream a stable progress protocol.** Version SSE event schema, emit counts, partial results, per-package errors, cancel/completion markers and run/session IDs. **Accept:** deterministic event ordering and no state corruption across scans.
- [ ] **[P1][M][perf] Support scan cancellation and prevent stale updates.** Rescan cancels/ignores older results and cleans up fetches; preserve last successful state. **Accept:** rapid repeated rescans leave only the newest selected scan visible.
- [ ] **[P1][M][perf] Tune bounded concurrency and per-host rate controls.** Separate npm and GitHub limits, timeouts, retries/backoff and configurable concurrency after benchmarking. **Accept:** no request bursts causing unnecessary 429s; sensible latency under slow networks.
- [ ] **[P1][M][perf] Add persistent, bounded cache where justified.** Cache metadata/notes across CLI invocations with TTL, schema version and invalidation; expose `--no-cache` and `cache clear` if shipped. **Accept:** user data/location secure, disk bounds and opt-out clear.
- [ ] **[P1][M][ux] Build an actionable diagnostics view.** Show skipped/error/deferred packages, exact reasons, request timing, cache stats and retry actions; include `copy diagnostics` with sensitive data redacted. **Accept:** every headline counter drills down to the responsible rows.
- [ ] **[P1][S][bug] Make failures distinct in every UI state.** Red for errors, amber for warnings/deferred, neutral for missing data, success only when truly verified. **Accept:** readable messages accessible without color alone.

### P1.3 Manager and configuration fidelity

- [ ] **[P1][L][core] Support workspaces, aliases and local references accurately.** Resolve `workspace:`, `catalog:`, `npm:` aliases, workspace protocols and supported manager overrides; link local packages rather than querying nonexistent registry versions. **Accept:** no incorrect “latest” comparisons; unsupported specs documented.
- [ ] **[P1][M][core] Improve manager/workspace root discovery.** Traverse sensible parent roots, honor lockfile ownership, ignore nested unrelated repos and support mixed-manager projects. **Accept:** path selection transparent and overrideable with `--dir`/workspace options.
- [ ] **[P1][M][core] Report actual toolchain executables safely.** Detect installed Node and npm/pnpm/Yarn/Bun versions without running untrusted scripts; compare against `engines`, `packageManager`, `devEngines` and runtime version. **Accept:** distinguish declared from observed versions in UI and JSON.
- [ ] **[P1][M][core] Resolve effective manager policy with documented precedence.** Include relevant pnpm global/project/environment and config-includes where feasible; do not treat Depnotes settings as manager settings. **Accept:** show `value`, `source` and `unresolved/unsupported` for each setting. See [pnpm configuration includes](https://pnpm.io/config-includes).
- [ ] **[P1][M][ux] Refine Settings UX.** User-level default, opt-in project overrides, source indicators, reset individual fields, validation messages, readable age durations, timezone-aware timestamps and theme preview. **Accept:** no surprise project config creation and no loss of unrelated user settings.
- [ ] **[P1][S][docs] Document registry/manager compatibility matrix.** Separate verified versions and formats from best-effort support, including private registries and package aliases. **Accept:** maintain table alongside fixtures/tests.

### P1.4 Usability, CLI and accessibility

- [ ] **[P1][M][ux] Audit full-viewport layout.** No document-level scrolling at desktop viewport, independent list/details scroll, sticky search/filter controls, mobile/narrow landscape behavior, keyboard escape from dialogs. **Accept:** Playwright viewport checks and no hidden controls at 200% zoom.
- [ ] **[P1][M][ux] Enhance package list triage.** Search/filter by update severity, status, workspace, source and age; stable sort; persist selected row on rescan; show exact target and baseline confidence. **Accept:** performant on thousands of rows and controls keyboard accessible.
- [ ] **[P1][M][ux] Design empty/loading/partial/offline states.** First-use guidance, distinct no-updates vs zero-scan vs all-skipped, skeleton/progress indicators and retry. **Accept:** user always knows whether data is final, partial or stale.
- [ ] **[P1][M][ux] Accessibility audit.** Screen-reader labels, keyboard navigation, focus restoration, live progress announcements, contrast in light/dark/system, reduced motion and mobile touch targets. **Accept:** automated axe checks plus manual keyboard smoke test.
- [ ] **[P1][M][cli] Harden CLI and machine-readable output.** Stable JSON schema/version, consistent exit codes, `--help`, `--version`, `--dir`, `--no-open`, `--port`, `--json`, configurable output formatting and noninteractive errors. **Accept:** contract tests and examples for CI scripts.
- [ ] **[P1][S][docs] Consolidate README and user documentation.** Remove stale version references and superseded claims, provide install/uninstall, troubleshooting and sample reports. **Accept:** docs align with current CLI and dashboard behavior.

### P1.5 Release readiness

- [ ] **[P1][M][integration] Prepare safe npm distribution.** Confirm `depnotes` name/ownership in registry, license files, metadata, supported Node versions, npm `bin` permissions, `files` allowlist, package tarball inspection, provenance and reproducible release procedure. **Accept:** fresh project can run installed package through `npm exec`/`pnpm dlx` after publication.
- [ ] **[P1][M][integration] Publish prereleases/canary versions and gather feedback.** Use SemVer changelog and rollback process. **Accept:** release smoke tests run against published tarball, not only local symlink.
- [ ] **[P1][M][test] Cross-manager installation matrix.** Verify building/running Depnotes using supported Node versions and scanning projects from npm/pnpm/Yarn/Bun, including Windows. **Accept:** documented pass/fail matrix in CI or release checklist.

---

## P2 — More power without sacrificing simplicity

### P2.1 Upgrade planning (keep read-only by default)

- [ ] **[P2][M][ux] Multi-select upgrade planning.** Choose packages and target versions, preview grouped changes by workspace, and export a plan. **Accept:** no writes merely from selecting.
- [ ] **[P2][M][core] Add peer/engine compatibility checks.** Detect likely conflicts from peer dependency ranges and runtime requirements; link source evidence. **Accept:** warnings distinguish definite conflicts from incomplete metadata.
- [ ] **[P2][M][core] Show transitive impact estimates.** Use lockfile graph to flag shared/affected dependencies, without pretending to predict every installation effect. **Accept:** clearly scoped dependency graph and confidence labels.
- [ ] **[P2][M][ux] Compare current, latest eligible, latest stable and selected target.** Show release ages, release timestamps and major jump count. **Accept:** users can explain why an older release was recommended.
- [ ] **[P2][M][cli] Export upgrade plan as JSON/Markdown.** Include sources, skipped reasons, timestamps and redacted metadata. **Accept:** deterministic, scriptable output.
- [ ] **[P2][L][core] Optional apply workflow with explicit confirmation.** Invoke the detected manager in a controlled subprocess, preview exact commands/diffs, respect workspaces/lockfiles and never install by default. **Accept:** dry run, confirmation, rollback guidance and tests for every supported manager before enabling.
- [ ] **[P2][M][core] Post-upgrade verification.** Optional controlled test/lint/build command suggestions; never run arbitrary scripts silently. **Accept:** clear provenance for each executed command and failure results.

### P2.2 Smarter presentation and review

- [ ] **[P2][M][ux] In-page Markdown navigation.** Table of contents, heading anchors, code copy, link previews, searchable notes and compare view. **Accept:** navigation works with keyboard and does not eagerly render enormous histories.
- [ ] **[P2][M][ux] Changelog deduplication.** Avoid showing identical text from Releases and CHANGELOG.md twice; preserve both citations. **Accept:** duplicate summaries merged without loss of source access.
- [ ] **[P2][M][ux] Save review state locally.** Mark reviewed, snooze/update-later, tag risk and export decisions; scope by project fingerprint. **Accept:** privacy-respecting local storage with reset/export.
- [ ] **[P2][M][ux] Risk heuristics with transparent rationale.** Major jumps, peer incompatibility, deprecations, missing notes and recent publication age. **Accept:** no unexplained numerical “safety” score.
- [ ] **[P2][S][ux] Add favorites/pinned packages and keyboard shortcuts.** **Accept:** documented shortcuts, no conflict with text inputs.

### P2.3 Integrations and extensibility

- [ ] **[P2][M][integration] GitHub/GitLab changelog provider abstraction.** Implement source plugins behind a small interface, not a general plugin framework. **Accept:** provider-independent tests and graceful unsupported hosts.
- [ ] **[P2][M][integration] Optional auth for private registries and GitHub.** Read approved existing credential mechanisms, never echo/store tokens, scrub diagnostic output. **Accept:** private package metadata works without sending tokens to unrelated hosts.
- [ ] **[P2][M][integration] Integrate with Renovate/Dependabot PRs.** Export links or annotate existing PRs via an explicit integration. **Accept:** no surprise repository modifications.
- [ ] **[P2][M][cli] CI-friendly `check` mode and exit policies.** Fail only for user-configured conditions (e.g., selected major updates, unreviewed breaking changes), with stable exit codes. **Accept:** useful in CI without requiring a dashboard.
- [ ] **[P2][M][integration] Add machine-readable and Markdown reports for PR comments/artifacts.** **Accept:** sanitized source-linked output and stable schema.
- [ ] **[P2][M][perf] Offline/cached inspection mode.** Inspect lockfile and cached notes without network with visible staleness labels. **Accept:** no hidden network requests when offline is selected.

### P2.4 Engineering quality

- [ ] **[P2][M][test] Property-based testing for SemVer and lockfile parsing.** Include malformed/fuzzed input, comments, oversized files and Unicode paths. **Accept:** failures produce minimized fixtures and parser never hangs.
- [ ] **[P2][M][perf] Profile large-workspace memory and rendering.** Test 1k–10k dependency rows, notes with long tables/code blocks, slow devices and `performance.mark` metrics. **Accept:** responsive input and bounded memory; adopt virtualization only if data supports it.
- [ ] **[P2][M][security] Add dependency audit and secure-release checklist.** Permissions, supply-chain checks, artifact attestations where appropriate, secret scan and disclosure policy. **Accept:** actionable automated and manual gate.
- [ ] **[P2][S][docs] Add CONTRIBUTING.md, architecture notes, fixtures guide and release checklist.** **Accept:** a new contributor can run tests and extend a package-manager parser.
- [ ] **[P2][M][core] Define public data contracts.** Version/validate API and SSE event payloads, add typed JSDoc or TypeScript checking without introducing build complexity unless warranted. **Accept:** breaking schema changes detected in tests.
- [ ] **[P2][M][perf] Add opt-in diagnostic profiling.** Request breakdowns, cache effectiveness, scan phase timing and optional anonymized benchmark export; no telemetry by default. **Accept:** local-first privacy preserved.

---

## P3 — Ideas to validate before investing

- [ ] **[P3][L][future] Optional AI-powered, source-cited change summaries.** Summarize only retrieved changelogs and migration docs, distinguish facts from inference, and allow provider/local-model selection. **Gate:** trustworthy note coverage and opt-in privacy model first.
- [ ] **[P3][L][future] Project-aware API usage scan.** Link breaking changes to actual imports/config/code references via opt-in static analysis. **Gate:** validated parsers and conservative false-positive handling.
- [ ] **[P3][L][future] Guided codemod or migration patch suggestions.** Produce previewable diffs with explicit user approval; never apply silently. **Gate:** high test coverage and safe undo path.
- [ ] **[P3][M][future] VS Code extension or editor integration.** Reuse CLI/core rather than duplicate scanner. **Gate:** demonstrated user demand.
- [ ] **[P3][M][future] TUI option for terminal-only review.** **Gate:** workflows not adequately served by `depnotes list/check` and browser UI.
- [ ] **[P3][L][future] Scheduled/watch mode for new releases.** Local notifications and configurable frequency, avoiding needless polling. **Gate:** opt-in, caching and rate limits proven.
- [ ] **[P3][L][future] Cross-project overview.** Review multiple local repositories and identify shared upgrade priorities. **Gate:** privacy, performance and project discovery semantics defined.
- [ ] **[P3][M][future] Integrate vulnerability/advisory metadata.** Link authoritative advisories and affected ranges; do not claim a package is safe merely because none is reported. **Gate:** reliable advisory coverage and licensing.
- [ ] **[P3][M][future] Ecosystem-specific migration packs.** Curated guides for React, Next.js, ESLint, TypeScript and similar high-impact stacks. **Gate:** maintainable, versioned source references.
- [ ] **[P3][L][future] Hosted collaboration service.** Only consider after a strong local product; define authentication, data retention, access controls and sustainable costs. **Gate:** explicit demand and a viable business case.

---

## Proposed execution order

| Milestone | Focus | Exit criteria |
|---|---|---|
| **v0.16 — Green baseline** | P0 test/reproducibility, deterministic E2E, fixture matrix, SSE regressions | Clean CI passes full Node + Playwright suites; no unverified “supported” formats |
| **v0.17 — Correctness & security** | Accurate baselines, registry config, release-age clarity, server hardening | Every package displays trustworthy provenance and errors; security regression tests pass |
| **v0.18 — Source coverage** | Better repo/changelog/migration discovery, coverage status | Version interval evidence demonstrably complete or flagged partial/unknown |
| **v0.19 — Performance & diagnostics** | Real-world benchmarks, cancellation, request tuning, diagnostics | Cold/warm and time-to-first-result measurements reported; large workspace usable |
| **v0.20 — Daily-use polish** | Accessibility, CLI/JSON stability, docs, distribution prerelease | Cross-platform smoke tests and first external-user feedback |
| **Post-v0.20** | Selective update plans, integrations, optional AI | Driven by feedback and explicit privacy/safety gates |

> Version numbers are organizational suggestions, not promised release dates. Pull a P0 bug forward immediately whenever discovered.

## Per-task implementation checklist

For each selected issue, record: **problem and reproduction**, affected package-manager versions, **proposed minimal solution**, tests/fixtures, performance/security impact, fallback behavior, documentation, and measured before/after results when applicable.

Suggested issue title format: `[P1][core] Show verified coverage for skipped major versions`.

## Source references / standards to revisit

- [pnpm settings](https://pnpm.io/settings) — minimum-release-age behavior and changing defaults.
- [pnpm config includes](https://pnpm.io/config-includes) — layered/delegated configuration complexity.
- [Playwright CI](https://playwright.dev/docs/ci) — reproducible browser verification.
- [Playwright webServer](https://playwright.dev/docs/test-webserver) — isolated local-server testing.
- [npm package.json documentation](https://docs.npmjs.com/cli/configuring-npm/package-json) — package metadata and toolchain declarations.
- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) — metadata response types and limitations.



## v0.16.0 upgrade workflow follow-ups

- [ ] P0: End-to-end tests for preview, approval, execution, and failed installs with an isolated fixture workspace.
- [ ] P0: Handle interruption/aborted upgrade subprocesses and inspect partial modifications safely.
- [ ] P1: Multi-package selection and grouped upgrade plans, preserving dependency sections.
- [ ] P1: Windows execution via a secure package-manager invocation strategy.
- [ ] P1: Git diff preview and post-upgrade lockfile/version verification.
- [ ] P1: Explicit lifecycle-script opt-in and safer defaults.
- [ ] P1: Rescan automatically after successful upgrades with progress reporting.
- [ ] P1: Extend support to catalog-based and alias dependencies without violating package-manager policies.


### Batch upgrade follow-ups (v0.17)

- [ ] Add transactional backup/restore strategy or rollback guidance for partial batch failures.
- [ ] Add post-upgrade verification and compatibility checks.
- [ ] Add Windows execution support and cross-platform end-to-end tests.
- [ ] Add bulk selection controls for visible / minor / patch packages with accessible confirmation.
- [ ] Ensure package-manager-specific range preservation and peer dependency migration behavior.


### v0.18 Git safety and recovery follow-ups

- [ ] P0: End-to-end test a dirty working tree confirmation and post-upgrade status with real Git repositories.
- [ ] P0: Verify all supported package-manager upgrade commands in isolated fixture workspaces.
- [ ] P1: Show a bounded, source-controlled file diff preview before applying an upgrade.
- [ ] P1: Provide an opt-in command to run selected project checks after upgrades, with timeout/output limits.
- [ ] P1: Persist resumable batch results across a dashboard reload without repeating successful commands.
- [ ] P1: Document safe manual recovery from interrupted package-manager operations.

## v0.19 developer tooling follow-up

- [ ] Generate and commit npm lockfile; switch CI installs to `npm ci`.
- [ ] Run ESLint and Playwright in CI and fix issues revealed by real dependency installations.
- [ ] Enable npm Trusted Publishing only after package ownership and GitHub workflow permissions are configured.
- [ ] Consider release build artifacts/standalone executable only when user demand justifies them.


## v0.20.0 — pnpm / Renovate / npm release follow-ups

- [ ] **P0:** Generate and commit a real `pnpm-lock.yaml` using `pnpm install` with registry access; confirm frozen installation on Node 24.
- [ ] **P0:** Run full lint, Node tests, and Playwright CI; resolve failures instead of disabling required checks.
- [ ] **P0:** Claim npm package `depnotes`, configure npm Trusted Publisher for the exact GitHub repository and `release-please.yml` workflow, and verify permissions.
- [ ] **P0:** Validate the first release end-to-end: release PR, version/tag, CI, publish, provenance, and `pnpm dlx depnotes`.
- [ ] **P1:** Enable Renovate GitHub integration; review onboarding and confirm cooldown, dashboard and lockfile-maintenance behavior.
- [ ] **P1:** Enable branch protection and optional `npm` environment approval.
- [ ] **P1:** Consider pinning GitHub Actions by immutable commit SHA and using GitHub dependency review/security scanning.
