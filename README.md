# ide-bash

Bash language-server adapter.

Registers the upstream [bash-language-server](https://github.com/bash-lsp/bash-language-server) npm package with the `ide` package, providing completion, diagnostics, navigation, and optional ShellCheck and shfmt integration for shell scripts.

## Features

- **Bundled server**: ships the upstream npm server with an optional custom executable path.
- **Managed toolchain**: installs verified ShellCheck and shfmt release assets while using the upstream server bundled with the adapter; a path you set yourself always wins.
- **Shell intelligence**: completes variables, functions, executables, builtins, keywords, options, and snippets.
- **Workspace analysis**: follows sourced files or indexes a configurable set of scripts for cross-file symbols and navigation.
- **ShellCheck**: reports diagnostics and offers quick fixes through a configured, managed, or PATH executable, with control over external-source traversal.
- **shfmt**: formats in Bash, POSIX, mksh, or Bats style through a configured, managed, or PATH executable.
- **Feature switches**: each capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first shell-script editor.

## Installation

To install `ide-bash` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-bash`.

Install `ide` first. Install ShellCheck and shfmt yourself or use IDE's managed-server view; explicitly configured paths take precedence.

## Usage

The managed ShellCheck and shfmt tools are used with the bundled server. A custom server uses explicitly configured tools or the executables on PATH, so its startup does not depend on the managed toolchain.

The upstream server currently inherits [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) through fast-glob, micromatch, and braces 3.0.3. Deeply nested glob patterns can exhaust the JavaScript stack and stop the server; no patched braces release is currently available. CI prints the audit report and a warning for this specific upstream advisory, while rejecting every other high or critical root advisory and failing when an audit report cannot be obtained or validated.

## Services

- `ide`: consumed to register the Bash adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
