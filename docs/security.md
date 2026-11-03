The adapter uses the official Bash server with narrowly scoped dependency fixes.

## Dependency fixes

EditorConfig 3.0.2, ESLint 10.14.0 and @eslint/config-array 0.23.5 still select minimatch 10, which is affected by [glob-pattern preprocessing denial of service](https://github.com/advisories/GHSA-g3hv-75wg-m249). Their own minimatch dependencies are overridden to the patched 11.0.4 release. The override is scoped to those consumers because minimatch 11 removed APIs used by other packages.

EditorConfig uses the supported escape function and Minimatch matching class. Node tests cover shell extension patterns, nested paths, dotfiles and escaped project paths; the live-server suite checks the Bash language features and formatting path. Lint validates the two development consumers with the same patched matching engine.

The pinned server sources are prepared through the TypeScript 7 compiler CLI, with an isolated configuration and atomic publication. Tests preserve CommonJS modules, runtime assets, concurrent preparation and syntax-error cleanup.

## Audit policy

Full and production-only npm audits reported no vulnerabilities on November 3, 2026. CI retains its existing high and critical advisory gate and rejects unsuccessful or malformed audit reports.
