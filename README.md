# Depnotes

Review direct dependency updates and their release notes in a local dashboard or terminal.
Depnotes supports npm, pnpm, Yarn, and Bun projects, including workspaces.

## Get started

Requires Node.js 24. Install the CLI globally:

```sh
npm install -g depnotes
cd /path/to/project
depnotes
```

The dashboard opens in your browser on a local address. Stop it with Ctrl+C. Scans need
network access to the public npm registry and GitHub. Optionally set `GITHUB_TOKEN` to
increase GitHub API rate limits.

```sh
depnotes --dir ../another-app     # inspect another project
depnotes --no-open --port 4177   # choose a port and open the URL yourself
depnotes list                    # list available upgrades
depnotes list --all --json       # include all dependencies as JSON
depnotes check react             # show notes for an outdated package
depnotes --help                  # see all options
```

## Dashboard and upgrades

Search and filter dependencies, inspect release notes and migration references, and adjust
settings. Scanning is read-only. To upgrade, select dependencies, review the proposed
package-manager commands, and confirm execution. On Windows, run the previewed commands
manually.

Upgrade commands can run package lifecycle scripts. If a command fails, later commands stop,
but earlier changes are not rolled back. Review the Git diff and run your project's tests.
The dashboard listens on `127.0.0.1`; do not expose it through a public proxy.

## Configuration

Use the dashboard's Settings dialog or create `depnotes.config.json` in the project root:

```json
{
  "minimumReleaseAge": 4320,
  "minimumReleaseAgeExclude": ["@myorg/*", "example@1.2.3"],
  "scanCacheSeconds": 30,
  "notesCacheSeconds": 120,
  "theme": "system"
}
```

The release age is in minutes and defaults to three days; `0` disables the age gate.
Cache durations are in seconds (0–3600) and are kept in memory. Themes are `system`,
`light`, and `dark`.

Settings are resolved per field, in descending priority: project config, user config,
root `pnpm-workspace.yaml` release-age settings, and defaults. User settings are stored in
`~/Library/Application Support/depnotes/config.json` on macOS,
`${XDG_CONFIG_HOME:-~/.config}/depnotes/config.json` on Linux, and
`%APPDATA%\depnotes\config.json` on Windows. Settings do not edit package-manager files.

## Limitations

- Only direct dependencies from the public npm registry are supported; private registry
  authentication is unavailable. Local, workspace, catalog, alias, and Git declarations are skipped.
- Supported lockfiles are pnpm YAML, modern npm JSON, Yarn Classic and modern, and Bun text
  JSONC. Binary `bun.lockb` is unsupported. Missing resolutions fall back to an estimated
  minimum version from the manifest.
- Release notes and migration references may be incomplete or cover multiple packages.
  Consult the package's official documentation before upgrading.
- Depnotes does not read every package-manager policy source, so recommendations may differ
  from the installer's effective policy.

## Development

Use Node.js 24 and pnpm 10.23.0:

```sh
pnpm install --frozen-lockfile
pnpm start --dir /path/to/project
pnpm check                       # lint, typecheck, unit and package tests
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm build` compiles the TypeScript application and the Tailwind dashboard stylesheet to `dist/`.
Dashboard styles live in `public/style.css`; use prefixed `tw:` utilities for shared styling and
ordinary CSS for theme variables and complex component states. The compiler scans the dashboard
HTML and browser TypeScript, so utility names must be written in full.

The package also exports
`depnotes/core` for programmatic use.

## License

MIT
