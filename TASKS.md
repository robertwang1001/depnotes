# Backlog

Candidate work, not a release schedule. Confirm the problem and scope before starting an item;
add focused tests and update the README when behavior changes.

## Correctness and safety

- [ ] Verify lockfile baselines across supported package-manager versions and workspaces. Clearly
  distinguish locked versions from manifest estimates and installed versions.
- [ ] Expand isolated upgrade tests across package managers, including dirty Git worktrees,
  failed or interrupted commands, and partial batch changes. Document recovery steps.
- [ ] Review loopback server, settings, upgrade endpoints, and release-note rendering for
  origin validation, path escapes, and untrusted content; add regression tests for gaps.
- [ ] Improve release-age policy reporting where manager settings cannot be resolved; avoid
  implying that a recommended version is guaranteed to install.

## Core workflow

- [ ] Improve release-note discovery and identify gaps in version-range coverage without
  claiming completeness from repository-wide releases.
- [ ] Evaluate support for configured registries and private packages, with credentials scoped
  to the correct host.
- [ ] Evaluate support for aliases, catalogs, and local workspace references; keep unsupported
  declarations explicit until they can be resolved accurately.
- [ ] Improve upgrade recovery and post-upgrade verification; investigate secure Windows
  execution and cross-platform tests.
- [ ] Verify scan cancellation, reconnection, and overlapping rescans; prevent stale results
  from replacing newer ones.

## Usability and maintenance

- [ ] Audit keyboard navigation, screen-reader announcements, contrast, and narrow layouts.
- [ ] Clarify partial, offline, skipped, and error states in the dashboard and CLI.
- [ ] Define and test a stable JSON output contract and exit behavior for automation.
- [ ] Benchmark representative workspaces before changing concurrency, caching, or rendering.
- [ ] Review cross-platform CLI and package smoke coverage, including paths with spaces and
  package-manager versions.

## Ideas for later

Consider peer and engine compatibility warnings, offline inspection, exportable review plans,
and integrations only when user demand and reliable source data justify them.
