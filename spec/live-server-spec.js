const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { LiveLspClient, fileUri, positionParams } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return { adapter, disposable };
};

const nodeExecutable = (directory, name, body) => {
  const script = path.join(directory, `${name}.js`);
  fs.writeFileSync(script, `#!/usr/bin/env node\n${body}`);
  if (process.platform !== "win32") {
    fs.chmodSync(script, 0o755);
    return script;
  }
  const wrapper = path.join(directory, `${name}.cmd`);
  fs.writeFileSync(wrapper, `@"${process.execPath}" "${script}" %*\r\n`);
  return wrapper;
};

describe("ide-bash bundled server", () => {
  let adapter, client, disposable, rootPath;
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-bash");
    ({ adapter, disposable } = registerAdapter());
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-bash-live-"));
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    fs.rmSync(rootPath, { recursive: true, force: true });
    await lumine.packages.deactivatePackage("ide-bash");
  });

  it("exercises every advertised feature, external tools, and the document lifecycle", async () => {
    // Node cannot spawn .cmd files with shell:false on Windows. The adapter and
    // server still run there; deterministic external-tool executables are used
    // on the Linux integration runner, where the complete feature contract is
    // enforced. Windows exercises the same requests with the optional tools off.
    const canRunFixtureTools = process.platform !== "win32";
    const shellcheck = nodeExecutable(
      rootPath,
      "shellcheck",
      `let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const comments = input.includes("echo $greeting")
    ? [{
        file: "-", line: 5, endLine: 5, column: 8, endColumn: 17,
        level: "warning", code: 2086, message: "Double quote to prevent globbing.",
        fix: { replacements: [{
          precedence: 0, line: 5, endLine: 5, column: 8, endColumn: 17,
          insertionPoint: "afterEnd", replacement: '"$greeting"'
        }] }
      }]
    : [];
  process.stdout.write(JSON.stringify({ comments }));
});
`,
    );
    const shfmt = nodeExecutable(
      rootPath,
      "shfmt",
      `let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => process.stdout.write(input.replace("  echo $greeting", "    echo $greeting")));
`,
    );
    lumine.config.set("ide-bash.bashIde.shellcheckEnabled", canRunFixtureTools);
    lumine.config.set("ide-bash.bashIde.shfmt.enabled", canRunFixtureTools);
    lumine.config.set("ide-bash.bashIde.shellcheckPath", canRunFixtureTools ? shellcheck : "");
    lumine.config.set("ide-bash.bashIde.shfmt.path", canRunFixtureTools ? shfmt : "");
    lumine.config.set("ide-bash.bashIde.includeAllWorkspaceSymbols", true);

    const filePath = path.join(rootPath, "fixture.sh");
    const source = [
      "#!/usr/bin/env bash",
      "# Greeting shown to users",
      'greeting="hello"',
      "show_message() {",
      "  echo $greeting",
      "}",
      "show_message",
      "echo $greeting",
      "gr",
      "",
    ].join("\n");
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    const { capabilities } = await client.start();
    client.open(uri, "shellscript", source);

    expect(capabilities.completionProvider).toBeDefined();
    expect(capabilities.hoverProvider).toBe(true);
    expect(capabilities.definitionProvider).toBe(true);
    expect(capabilities.referencesProvider).toBe(true);
    expect(capabilities.documentHighlightProvider).toBe(true);
    expect(capabilities.documentSymbolProvider).toBe(true);
    expect(capabilities.workspaceSymbolProvider).toBe(true);
    expect(capabilities.documentFormattingProvider).toBe(true);
    expect(capabilities.renameProvider.prepareProvider).toBe(true);
    expect(capabilities.codeActionProvider.codeActionKinds).toEqual(["quickfix"]);

    const published = await client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .find(({ params }) => (canRunFixtureTools ? params.diagnostics.length > 0 : true)),
      "initial diagnostics",
    );
    const diagnostic = published.params.diagnostics[0];
    if (canRunFixtureTools) {
      expect(diagnostic.code).toBe("SC2086");
      expect(diagnostic.codeDescription.href).toContain("SC2086");
    } else {
      expect(published.params.diagnostics).toEqual([]);
    }

    const completion = await client.request("textDocument/completion", positionParams(uri, 8, 2));
    const greetingCompletion = completion.find(({ label }) => label === "greeting");
    expect(greetingCompletion).toBeDefined();
    const resolved = await client.request("completionItem/resolve", greetingCompletion);
    expect(resolved.label).toBe("greeting");

    const hover = await client.request("textDocument/hover", positionParams(uri, 4, 10));
    expect(hover.contents.value).toContain("Greeting shown to users");

    const definition = await client.request("textDocument/definition", positionParams(uri, 4, 10));
    expect(definition[0].range.start.line).toBe(2);

    const references = await client.request("textDocument/references", {
      ...positionParams(uri, 4, 10),
      context: { includeDeclaration: true },
    });
    expect(references.length).toBe(3);

    const highlights = await client.request(
      "textDocument/documentHighlight",
      positionParams(uri, 4, 10),
    );
    expect(highlights.length).toBe(3);

    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    expect(symbols.map(({ name }) => name)).toEqual(["greeting", "show_message"]);

    const workspaceSymbols = await client.request("workspace/symbol", {
      query: "show",
    });
    expect(workspaceSymbols[0].name).toBe("show_message");

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    if (canRunFixtureTools) expect(edits[0].newText).toContain("    echo $greeting");
    else expect(edits).toBeNull();

    const prepared = await client.request("textDocument/prepareRename", positionParams(uri, 4, 10));
    expect(prepared.start.character).toBe(8);
    const rename = await client.request("textDocument/rename", {
      ...positionParams(uri, 4, 10),
      newName: "salutation",
    });
    expect(rename.changes[uri].map(({ newText }) => newText)).toEqual([
      "salutation",
      "salutation",
      "salutation",
    ]);

    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: diagnostic?.range || {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      context: { diagnostics: diagnostic ? [diagnostic] : [] },
    });
    if (canRunFixtureTools) {
      expect(actions[0].title).toBe("Apply fix for SC2086");
      expect(actions[0].edit.changes[uri][0].newText).toBe('"$greeting"');
    } else {
      expect(actions).toEqual([]);
    }

    const beforeChange = client.messages("textDocument/publishDiagnostics").length;
    const fixed = source.replaceAll("echo $greeting", 'echo "$greeting"');
    client.change(uri, fixed);
    await client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .slice(beforeChange)
          .find(({ params }) => params.version === 2 && params.diagnostics.length === 0),
      "cleared diagnostics after didChange",
    );

    const beforeClose = client.messages("textDocument/publishDiagnostics").length;
    client.closeDocument(uri);
    await client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .slice(beforeClose)
          .find(({ params }) => params.diagnostics.length === 0),
      "cleared diagnostics after didClose",
    );
  });
});
