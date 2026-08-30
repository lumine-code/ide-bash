const fs = require("fs");
const {
  resolveServer,
  installServer,
  toolPaths,
  shellcheckAsset,
  shfmtAsset,
} = require("../lib/server");
const main = require("../lib/main");

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

describe("ide-bash server resolution", () => {
  it("prefers the configured path and launches the start command", async () => {
    const launch = await resolveServer(process.execPath, "debug");
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["start"]);
    expect(launch.env.BASH_IDE_LOG_LEVEL).toBe("debug");
  });

  it("falls back to the bundled server module", async () => {
    const launch = await resolveServer("");
    expect(launch.command).toBe(process.execPath);
    expect(fs.existsSync(launch.args[0])).toBe(true);
    expect(launch.args[1]).toBe("start");
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
    const metadata = require("@lumine-code/bash-language-server/package.json");
    expect(metadata.name).toBe("@lumine-code/bash-language-server");
    expect(metadata.version).toBe("6.0.0");
    expect(metadata.dependencies.editorconfig).toBe("3.0.2");
    expect(
      fs.existsSync(
        require.resolve("@lumine-code/bash-language-server/server/tree-sitter-bash.wasm"),
      ),
    ).toBe(true);
  });

  it("prefers a managed install over the bundled server", async () => {
    const managed = { modulePath: "/managed/cli.js", version: "9.9.9" };
    const launch = await resolveServer("", "info", managed);
    expect(launch.args[0]).toBe(managed.modulePath);
    expect(launch.version).toBe("9.9.9");
    expect((await resolveServer(process.execPath, "info", managed)).command).toBe(process.execPath);
  });

  it("names the exact shellcheck asset for each platform", () => {
    // shellcheck ships a .tar.gz beside every .tar.xz, so nothing needs xz.
    expect(shellcheckAsset({ platform: "linux", arch: "x64", version: "0.11.0" })).toBe(
      "shellcheck-v0.11.0.linux.x86_64.tar.gz",
    );
    expect(shellcheckAsset({ platform: "darwin", arch: "arm64", version: "0.11.0" })).toBe(
      "shellcheck-v0.11.0.darwin.aarch64.tar.gz",
    );
    // One zip covers every Windows architecture.
    expect(shellcheckAsset({ platform: "win32", arch: "x64", version: "0.11.0" })).toBe(
      "shellcheck-v0.11.0.zip",
    );
    expect(shellcheckAsset({ platform: "aix", arch: "ppc64", version: "0.11.0" })).toBeNull();
  });

  it("names the exact shfmt asset for each platform", () => {
    expect(shfmtAsset({ platform: "linux", arch: "x64", version: "3.13.1" })).toBe(
      "shfmt_v3.13.1_linux_amd64",
    );
    expect(shfmtAsset({ platform: "win32", arch: "x64", version: "3.13.1" })).toBe(
      "shfmt_v3.13.1_windows_amd64.exe",
    );
    expect(shfmtAsset({ platform: "aix", arch: "ppc64", version: "3.13.1" })).toBeNull();
  });

  it("reports no tools until something is installed", () => {
    expect(toolPaths(null)).toEqual({ shellcheck: null, shfmt: null });
    const tools = toolPaths({ directory: "/inst" });
    expect(tools.shellcheck).toContain("tools");
    expect(tools.shfmt).toContain("tools");
  });

  it("fetches the server and both tools it shells out to", async () => {
    // The descriptor is one-server-per-adapter, so this shape needs the hook.
    const calls = [];
    const storagePath = fs.mkdtempSync(require("path").join(require("os").tmpdir(), "bash-"));
    const api = {
      setServerInstallationStatus: (status) => calls.push(["status", status]),
      npmPackageLatestVersion: async () => "5.6.0",
      npmInstallPackage: async (name, version) => calls.push(["npm", name, version]),
      latestGithubRelease: async (repo) => ({
        version: repo === "koalaman/shellcheck" ? "0.11.0" : "3.13.1",
        tag: "v1",
        assets: [
          {
            name: shfmtAsset({ platform: process.platform, arch: process.arch, version: "3.13.1" }),
            url: "https://x/shfmt",
            size: 1,
          },
        ],
      }),
      downloadFile: async (url, destination) => {
        calls.push(["download", url]);
        fs.writeFileSync(destination, "x");
        return destination;
      },
      makeFileExecutable: async () => {},
    };

    const result = await installServer({ storagePath, api });

    expect(result.version).toBe("5.6.0");
    expect(result.module).toContain("bash-language-server");
    // The server through npm so its dependency tree comes with it, and shfmt as
    // a raw executable; shellcheck publishes no matching asset in this stub.
    expect(calls).toContain(jasmine.arrayContaining(["npm", "@lumine-code/bash-language-server"]));
    expect(calls.some(([kind, url]) => kind === "download" && url === "https://x/shfmt")).toBe(
      true,
    );
    fs.rmSync(storagePath, { recursive: true, force: true });
  });
});

describe("ide-bash adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-bash");
    ({ adapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-bash");
  });

  it("registers with the language-server service", async () => {
    expect(adapter.id).toBe("ide-bash");
    expect(adapter.grammarScopes).toEqual(["source.shell"]);
    expect(adapter.settingsKeyPaths).toEqual(["ide-bash"]);
    const launch = await adapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
  });

  it("answers the bashIde configuration section", () => {
    lumine.config.set("ide-bash.bashIde.backgroundAnalysisMaxFiles", 120);
    lumine.config.set("ide-bash.bashIde.includeAllWorkspaceSymbols", true);
    lumine.config.set("ide-bash.bashIde.shellcheckArguments", ["--severity=warning"]);

    const settings = adapter.getWorkspaceConfiguration("bashIde");
    expect(settings.backgroundAnalysisMaxFiles).toBe(120);
    expect(settings.includeAllWorkspaceSymbols).toBe(true);
    expect(settings.shellcheckArguments).toEqual(["--severity=warning"]);
    expect(settings.shellcheckExternalSources).toBe(true);
    expect(adapter.getWorkspaceConfiguration("editor")).toBeUndefined();
  });

  it("maps diagnostics and formatting switches onto their external tools", () => {
    expect(adapter.getSettings().bashIde.shellcheckPath).toBe("shellcheck");
    expect(adapter.getSettings().bashIde.shfmt.path).toBe("shfmt");

    lumine.config.set("ide-bash.features.diagnostics", false);
    lumine.config.set("ide-bash.features.format", false);
    const settings = adapter.getSettings().bashIde;
    expect(settings.enableSourceErrorDiagnostics).toBe(false);
    expect(settings.shellcheckPath).toBe("");
    expect(settings.shfmt.path).toBe("");
  });

  it("transcribes shfmt settings", () => {
    lumine.config.set("ide-bash.bashIde.shfmt.languageDialect", "posix");
    lumine.config.set("ide-bash.bashIde.shfmt.caseIndent", true);
    lumine.config.set("ide-bash.bashIde.shfmt.simplifyCode", true);

    const { shfmt } = adapter.getWorkspaceConfiguration("bashIde");
    expect(shfmt.languageDialect).toBe("posix");
    expect(shfmt.caseIndent).toBe(true);
    expect(shfmt.simplifyCode).toBe(true);
  });

  it("offers switches for exactly the capabilities the server advertises", () => {
    const { configSchema } = require("../package.json");
    expect(Object.keys(configSchema.features.properties)).toEqual([
      "diagnostics",
      "autocomplete",
      "hover",
      "definition",
      "references",
      "symbols",
      "format",
      "rename",
      "codeActions",
    ]);
  });
});

describe("ide-bash feature contracts", () => {
  const features = [
    "diagnostics",
    "autocomplete",
    "hover",
    "definition",
    "references",
    "symbols",
    "format",
    "rename",
    "codeActions",
  ];
  const definitions = require("../package.json").configSchema.features.properties;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-bash");
  });

  afterEach(async () => {
    for (const feature of features) lumine.config.unset(`ide-bash.features.${feature}`);
    await lumine.packages.deactivatePackage("ide-bash");
  });

  for (const feature of features) {
    it(`exposes ${feature} as an independent enabled-by-default switch`, () => {
      expect(definitions[feature].type).toBe("boolean");
      expect(definitions[feature].default).toBe(true);
      const keyPath = `ide-bash.features.${feature}`;
      expect(lumine.config.get(keyPath)).toBe(true);
      lumine.config.set(keyPath, false);
      expect(lumine.config.get(keyPath)).toBe(false);
    });
  }
});
