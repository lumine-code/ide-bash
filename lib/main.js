const { resolveServer, installServer, latestServerVersion, toolPaths } = require("./server");

const setting = (key) => lumine.config.get(`ide-bash.${key}`);
const configuredToolPath = (enabledKey, pathKey, managedPath, fallback) =>
  setting(enabledKey) ? setting(pathKey) || managedPath || fallback : "";

const bashIdeSettings = (tools = {}) => {
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
    const toolsByLaunch = new WeakMap();
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
        const launch = await resolveServer(
          context,
          setting("serverPath"),
          setting("bashIde.logLevel"),
        );
        if (!launch) return null;
        // Every process generation keeps the tools it was launched with. A
        // concurrent launch or service replacement cannot change its paths.
        toolsByLaunch.set(launch, toolPaths(context.managedServer));
        return launch;
      },
      getSettings({ launch } = {}) {
        return { bashIde: bashIdeSettings(toolsByLaunch.get(launch)) };
      },
    };

    return service.registerAdapter(adapter);
  },
};
