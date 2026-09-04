const { resolveServer, installServer, latestServerVersion, toolPaths } = require("./server");

const setting = (key) => lumine.config.get(`ide-bash.${key}`);
const configuredToolPath = (enabledKey, pathKey, managedPath, fallback) =>
  setting(enabledKey) ? setting(pathKey) || managedPath || fallback : "";

// Where the tools the editor installed sit, settled the last time a server was
// resolved. Empty until then, which is also what an uninstall leaves behind.
let managedTools = { shellcheck: null, shfmt: null };

const bashIdeSettings = (tools = managedTools) => {
  return {
    backgroundAnalysisMaxFiles: setting("bashIde.backgroundAnalysisMaxFiles"),
    enableSourceErrorDiagnostics: setting("bashIde.enableSourceErrorDiagnostics"),
    globPattern: setting("bashIde.globPattern"),
    explainshellEndpoint: setting("bashIde.explainshellEndpoint"),
    logLevel: setting("bashIde.logLevel"),
    includeAllWorkspaceSymbols: setting("bashIde.includeAllWorkspaceSymbols"),
    shellcheckArguments: setting("bashIde.shellcheckArguments") || [],
    shellcheckExternalSources: setting("bashIde.shellcheckExternalSources"),
    shellcheckPath: configuredToolPath(
      "bashIde.shellcheckEnabled",
      "bashIde.shellcheckPath",
      tools.shellcheck,
      "shellcheck",
    ),
    shfmt: {
      path: configuredToolPath("bashIde.shfmt.enabled", "bashIde.shfmt.path", tools.shfmt, "shfmt"),
      ignoreEditorconfig: setting("bashIde.shfmt.ignoreEditorconfig"),
      languageDialect: setting("bashIde.shfmt.languageDialect"),
      binaryNextLine: setting("bashIde.shfmt.binaryNextLine"),
      caseIndent: setting("bashIde.shfmt.caseIndent"),
      funcNextLine: setting("bashIde.shfmt.funcNextLine"),
      simplifyCode: setting("bashIde.shfmt.simplifyCode"),
      spaceRedirects: setting("bashIde.shfmt.spaceRedirects"),
    },
  };
};

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-bash",
      displayName: "Bash Language Server",
      grammarScopes: ["source.shell"],
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-bash"],
      restartKeyPaths: ["ide-bash.serverPath", "ide-bash.bashIde.logLevel"],
      bundledServer: true,
      managedServerDisplayName: "Bash Toolchain",
      installServer,
      latestServerVersion,
      async resolveServer(context) {
        // The tools the managed install carries are remembered here, because
        // the settings the server pulls have no context to read them from.
        managedTools = toolPaths(context.managedServer);
        const launch = await resolveServer(
          setting("serverPath"),
          setting("bashIde.logLevel"),
          context.managedServer,
        );
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getSettings() {
        return { bashIde: bashIdeSettings(managedTools) };
      },
      getWorkspaceConfiguration(section) {
        if (!section) return { bashIde: bashIdeSettings(managedTools) };
        return section === "bashIde" ? bashIdeSettings(managedTools) : undefined;
      },
    };

    return service.registerAdapter(adapter);
  },
};
