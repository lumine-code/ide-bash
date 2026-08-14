# ide-bash

Bash language-server adapter.

Registers the maintained [@lumine-code/bash-language-server](https://github.com/lumine-code/bash-language-server) fork with the bundled `ide-client` package, providing completion, diagnostics, navigation, and optional ShellCheck and shfmt integration for shell scripts.

## Features

- **Bundled server**: pins the audited lumine-code fork to an immutable commit, with an optional custom executable path.
- **Managed install**: fetches a newer server together with `shellcheck` and `shfmt`, so diagnostics and formatting work without hunting down either tool; a path you set yourself always wins.
- **Shell intelligence**: completes variables, functions, executables, builtins, keywords, options, and snippets.
- **Workspace analysis**: follows sourced files or indexes a configurable set of scripts for cross-file symbols and navigation.
- **ShellCheck**: reports diagnostics and offers quick fixes when the separately installed executable is available, with control over external-source traversal.
- **shfmt**: formats in Bash, POSIX, mksh, or Bats style when the separately installed executable is available.
- **Feature switches**: each capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first shell-script editor.

## Installation

To install `ide-bash` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-bash`. Install `shellcheck` for diagnostics and fixes, and `shfmt` for formatting; the language server discovers both on PATH by default.

## Services

- `ide-client`: consumed to register the Bash adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
