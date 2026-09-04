const fs = require("fs");
const {
  resolveServer,
  installServer,
  latestServerVersion,
  toolchainVersion,
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

  it("keeps the bundled server when a managed toolchain is installed", async () => {
    const managed = { modulePath: "/managed/cli.js", version: "9.9.9" };
    const launch = await resolveServer("", "info", managed);
    expect(launch.args[0]).not.toBe(managed.modulePath);
    expect(launch.args[0]).toBe(
      require.resolve("@lumine-code/bash-language-server/server/out/cli.js"),
    );
    expect(launch.version).toBe("6.0.0");
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

  it("fetches and verifies both managed tools without inventing a server package", async () => {
    const calls = [];
    const storagePath = fs.mkdtempSync(require("path").join(require("os").tmpdir(), "bash-"));
    const releaseFor = (repo) => {
      const shellcheck = repo === "koalaman/shellcheck";
      const version = shellcheck ? "0.11.0" : "3.13.1";
      const name = shellcheck
        ? shellcheckAsset({ platform: process.platform, arch: process.arch, version })
        : shfmtAsset({ platform: process.platform, arch: process.arch, version });
      return {
        version,
        tag: `v${version}`,
        assets: [
          { name, url: `https://x/${shellcheck ? "shellcheck" : "shfmt"}`, digest: "sha256:abc" },
        ],
      };
    };
    const api = {
      setServerInstallationStatus: (status) => calls.push(["status", status]),
      latestGithubRelease: async (repo) => releaseFor(repo),
      githubReleaseByTag: async (repo, tag) => {
        calls.push(["release", repo, tag]);
        return releaseFor(repo);
      },
      downloadFile: async (url, destination, options = {}) => {
        calls.push(["download", url, options]);
        if (url.endsWith("/shellcheck")) {
          const nested = require("path").join(destination, "release");
          fs.mkdirSync(nested, { recursive: true });
          fs.writeFileSync(
            require("path").join(
              nested,
              process.platform === "win32" ? "shellcheck.exe" : "shellcheck",
            ),
            "x",
          );
        } else {
          fs.writeFileSync(destination, "x");
        }
        return destination;
      },
      makeFileExecutable: async () => {},
    };

    const version = await latestServerVersion(api);
    expect(version).toBe("0.11.0.3.13.1");
    expect(
      toolchainVersion({ shellcheck: { version: "0.11.0" }, shfmt: { version: "3.13.1" } }),
    ).toBe(version);
    const result = await installServer({ storagePath, version, api });

    expect(result).toEqual({
      version,
      tools: { shellcheck: "0.11.0", shfmt: "3.13.1" },
    });
    expect(calls).toContain(["release", "koalaman/shellcheck", "v0.11.0"]);
    expect(calls).toContain(["release", "mvdan/sh", "v3.13.1"]);
    const downloads = calls.filter(([kind]) => kind === "download");
    expect(downloads).toHaveSize(2);
    expect(downloads.every(([, , options]) => options.digest === "sha256:abc")).toBe(true);
    expect(downloads.find(([, url]) => url.endsWith("/shellcheck"))[2].type).toBe(
      process.platform === "win32" ? "zip" : "gzip-tar",
    );
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  it("fails closed when a required tool asset or digest is missing", async () => {
    const storagePath = fs.mkdtempSync(require("path").join(require("os").tmpdir(), "bash-"));
    const release = (repo) => ({
      version: repo === "koalaman/shellcheck" ? "0.11.0" : "3.13.1",
      assets: [],
    });
    const api = {
      setServerInstallationStatus() {},
      latestGithubRelease: async (repo) => release(repo),
    };
    await expectAsync(installServer({ storagePath, api })).toBeRejectedWithError(/release asset/);

    const shellcheckName = shellcheckAsset({
      platform: process.platform,
      arch: process.arch,
      version: "0.11.0",
    });
    api.latestGithubRelease = async (repo) => ({
      version: repo === "koalaman/shellcheck" ? "0.11.0" : "3.13.1",
      assets: [{ name: shellcheckName, url: "https://x/tool" }],
    });
    await expectAsync(installServer({ storagePath, api })).toBeRejectedWithError(/digest/);
    fs.rmSync(storagePath, { recursive: true, force: true });
  });
});

describe("ide-bash adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-bash");
    ({ adapter, disposable } = registerAdapter());
    await adapter.resolveServer({ rootPath: __dirname, managedServer: null });
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-bash");
  });

  it("registers with the language-server service", async () => {
    expect(adapter.id).toBe("ide-bash");
    expect(adapter.grammarScopes).toEqual(["source.shell"]);
    expect(adapter.settingsKeyPaths).toEqual(["ide-bash"]);
    expect(adapter.restartKeyPaths).toEqual(["ide-bash.serverPath", "ide-bash.bashIde.logLevel"]);
    expect(adapter.bundledServer).toBe(true);
    expect(adapter.managedServerDisplayName).toBe("Bash Toolchain");
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

  it("leaves external tools available for grammar-scoped feature overrides", () => {
    expect(adapter.getSettings().bashIde.shellcheckPath).toBe("shellcheck");
    expect(adapter.getSettings().bashIde.shfmt.path).toBe("shfmt");

    lumine.config.set("ide-bash.features.diagnostics", false);
    lumine.config.set("ide-bash.features.format", false);
    const settings = adapter.getSettings().bashIde;
    expect(settings.enableSourceErrorDiagnostics).toBe(false);
    expect(settings.shellcheckPath).toBe("shellcheck");
    expect(settings.shfmt.path).toBe("shfmt");
  });

  it("prefers managed tools by default and preserves explicit paths or disablement", async () => {
    const managed = { directory: require("path").join(__dirname, "managed"), version: "1.0.0" };
    await adapter.resolveServer({ rootPath: __dirname, managedServer: managed });
    let settings = adapter.getSettings().bashIde;
    expect(settings.shellcheckPath).toBe(toolPaths(managed).shellcheck);
    expect(settings.shfmt.path).toBe(toolPaths(managed).shfmt);

    lumine.config.set("ide-bash.bashIde.shellcheckPath", "/custom/shellcheck");
    lumine.config.set("ide-bash.bashIde.shfmt.enabled", false);
    settings = adapter.getSettings().bashIde;
    expect(settings.shellcheckPath).toBe("/custom/shellcheck");
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
