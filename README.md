# ide-bash

Bash language-server adapter.

Registers the maintained [@lumine-code/bash-language-server](https://github.com/lumine-code/bash-language-server) fork with the `ide-client` package, providing completion, diagnostics, navigation, and optional ShellCheck and shfmt integration for shell scripts.

## Features

- **Bundled server**: pins the audited lumine-code fork to an immutable commit, with an optional custom executable path.
- **Managed toolchain**: installs verified ShellCheck and shfmt release assets while continuing to use the audited server fork bundled with the adapter; a path you set yourself always wins.
- **Shell intelligence**: completes variables, functions, executables, builtins, keywords, options, and snippets.
- **Workspace analysis**: follows sourced files or indexes a configurable set of scripts for cross-file symbols and navigation.
- **ShellCheck**: reports diagnostics and offers quick fixes through a configured, managed, or PATH executable, with control over external-source traversal.
- **shfmt**: formats in Bash, POSIX, mksh, or Bats style through a configured, managed, or PATH executable.
- **Feature switches**: each capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first shell-script editor.

## Installation

Install `ide-client` first. Then install `ide-bash` from the Install pane of the Lumine settings, or run `lumine --install lumine-code/ide-bash`. Install ShellCheck and shfmt yourself or use IDE Client's managed-server view; explicitly configured paths take precedence.

## Services

- `ide-client`: consumed to register the Bash adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
