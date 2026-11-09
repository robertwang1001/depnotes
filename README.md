# Depnotes

A local dashboard and CLI for reviewing direct dependency upgrades and their release notes.
Depnotes scans pnpm, npm, Yarn, and Bun projects, including workspaces. It compares dependency
baselines with the public npm registry, applies a minimum release age, and retrieves GitHub
releases, changelog sections, and migration references.

Scanning is read-only. Optional dashboard upgrades require a preview and explicit confirmation.

## Requirements and setup

Use **Node.js 24** and **pnpm 10.23.0**, matching `package.json` and CI.

```sh
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm link --global
```

From the project you want to inspect:

```sh
depnotes
```

The CLI prints a loopback URL and opens the dashboard. Use `--no-open` to open it yourself.
Stop the server with Ctrl+C. Network access to npm and GitHub is required for live scans.
`GITHUB_TOKEN` is optional and increases GitHub API rate limits; never commit tokens.

You can also run the compiled CLI without linking:

```sh
node /absolute/path/to/depnotes/dist/bin/cli.js --dir /path/to/project --no-open
```

For development, `pnpm start --dir /path/to/project` builds before launching.
Rebuild after editing TypeScript; JavaScript output lives in `dist/` and is ignored by Git.

## Commands

```sh
depnotes                          # launch the local dashboard
depnotes --no-open --port 4177     # use a fixed port without opening a browser
depnotes --dir ../another-app     # inspect another project
depnotes list                     # print outdated dependencies
depnotes list --all               # include current, deferred, and skipped items
depnotes list --json              # machine-readable report
depnotes check react              # matched GitHub release notes
depnotes --help
```

`--dir` also works with `list` and `check`. If a linked command points to an older checkout,
check `command -v depnotes`, rebuild, and recreate the global link.

## Dashboard

- Search, filter, and sort dependencies by package, workspace, status, or upgrade kind.
- Review progressively streamed results, release-age deferrals, and per-package errors.
- Expand formatted release notes and follow links to their sources. Raw HTML and remote
  images are disabled in the Markdown renderer.
- Open Diagnostics for scan timings and network/cache metrics.
- Use Settings for release age, exceptions, cache durations, and system/light/dark themes.
- Select upgrades, preview grouped package-manager commands, and confirm execution.

Release-note coverage is unverified: repository releases may cover multiple packages, and
changelog discovery cannot prove that every breaking change was found.

## Settings

Higher-priority configuration overrides only the fields it provides:

1. `<project>/depnotes.config.json`
2. User configuration
3. Root `pnpm-workspace.yaml` release-age settings, for pnpm projects
4. Depnotes defaults

User configuration locations:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/depnotes/config.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/depnotes/config.json` |
| Windows | `%APPDATA%\depnotes\config.json` |

The Settings dialog defaults to user preferences; select project scope for a project override.
Writes are atomic. Resetting a scope removes its overrides so lower-priority values apply.
Package-manager configuration files are never edited by Settings.

```json
{
  "minimumReleaseAge": 4320,
  "minimumReleaseAgeExclude": ["@myorg/*", "example@1.2.3"],
  "scanCacheSeconds": 30,
  "notesCacheSeconds": 120,
  "theme": "system"
}
```

Release age is measured in **minutes**, with a default of three days; the dashboard displays
days. Setting it to zero disables the gate. Candidates with missing publication timestamps
are not assumed eligible. Exceptions support names, scope globs, and exact versions with
`||` alternatives. Cache durations accept 0–3600 seconds and remain in memory.

Depnotes does not resolve every package-manager policy source, including delegated/global
pnpm settings, so its recommendations may differ from the installer's effective policy.

## Upgrade safety and limitations

The server binds to `127.0.0.1`; keep it local. Settings and upgrades require same-origin
requests. Do not expose the dashboard through a public interface or proxy.

Upgrades are limited to eligible registry dependencies and run one command per workspace
and dependency category, with at most 100 selections. The server revalidates declarations
before execution and warns about uncommitted Git changes. Package-manager lifecycle scripts
may run. A failure stops later commands; earlier changes are not rolled back. Review the
Git diff, rescan, and run the target project's tests afterward. Windows users must execute
the previewed commands manually.

Other limitations:

- Only the public npm registry is supported; private registry authentication is unavailable.
- Direct dependencies are scanned, rather than the full transitive graph.
- Local, workspace, catalog, alias, and Git dependency declarations are skipped.
- Supported lockfiles are pnpm YAML, modern npm JSON, Yarn Classic/modern, and Bun text JSONC.
  Binary `bun.lockb` is unsupported. Missing resolutions fall back to the manifest's minimum
  allowed version, clearly labeled as an estimate.
- GitHub lookup inspects up to 300 releases and bounded changelog content. Consult official
  migration documentation when coverage is incomplete.

## Development

All application code, scripts, configs, unit tests, and browser tests are TypeScript. Strict
checking covers the whole project. NodeNext imports use `.js` extensions so the compiled
ES modules run directly in Node and browsers. Development build/hook scripts run with
Node 24's built-in TypeScript stripping; installed application code uses compiled JavaScript.

```sh
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm test
pnpm test:package
pnpm coverage
pnpm exec playwright install chromium
pnpm test:e2e
pnpm bench:scan
pnpm pack:check
pnpm check
```

`pnpm test`, `pnpm test:package`, `pnpm test:e2e`, and `pnpm bench:scan` build first. Unit tests run explicitly from
`dist/test/`; Playwright runs the TypeScript specs against a compiled fixture server with
local deterministic metadata. The benchmark also uses fixtures and does not contact npm
or GitHub. `pnpm check` runs lint and strict type checking, builds once, and then runs unit tests
and the packaged-consumer smoke test.

Git hooks install only in this repository's own Git checkout. Staged TypeScript files are
linted, and commit messages follow Conventional Commits.

### Source layout

| Path | Responsibility |
| --- | --- |
| `bin/cli.ts` | Argument parsing, terminal output, browser launch |
| `src/core.ts` | Scan orchestration and release-note retrieval |
| `src/types.ts` | Shared scanner, settings, and API contracts |
| `src/lockfile.ts` | Workspace discovery and lockfile baselines |
| `src/package-manager.ts` | Package-manager detection |
| `src/http-client.ts` | Bounded caching, deduplication, retries |
| `src/config.ts` | Settings validation, precedence, persistence |
| `src/server.ts` | Loopback HTTP API and explicit static asset serving |
| `src/upgrade.ts`, `src/git-safety.ts` | Upgrade planning, execution, Git inspection |
| `src/changelog.ts`, `src/markdown.ts` | Changelog extraction and safe HTML rendering |
| `public/` | Typed browser UI, static HTML/CSS, original SVG brand assets |
| `test/`, `e2e/` | Node tests and Playwright fixtures/specs |
| `scripts/build.ts` | Compile TypeScript and copy static assets |

### Packaging and releases

`pnpm build` produces JavaScript, declaration files, and source maps. The package's CLI and
`depnotes/core` export point into `dist/`. Packing automatically builds and includes the
compiled application, browser assets, declarations, and hook setup script; tests and fixtures
are excluded from the published package. Source maps embed their TypeScript sources. The
package smoke test installs the packed tarball using the existing pnpm store and the registry
if needed, then checks the installed CLI, public core export, and dashboard assets.

CI verifies Node 24, lint, type checking, unit tests, package contents, and Chromium tests.
Renovate manages dependency updates with a three-day release cooldown. Release Please
prepares release PRs and tags on `main`. A created release triggers verification of that
exact tag before npm Trusted Publishing with provenance; ordinary pushes do not publish.

Before automated publication, claim the npm package, configure its Trusted Publisher for
this repository's `release-please.yml`, and create the `npm` GitHub environment. Verify
`pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm test:e2e` before releasing.
