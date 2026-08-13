const { CompositeDisposable } = require("lumine");
const { resolveServer, installServer, toolPaths } = require("./server");

const setting = (key) => lumine.config.get(`ide-bash.${key}`);

// Where the tools the editor installed sit, settled the last time a server was
// resolved. Empty until then, which is also what an uninstall leaves behind.
let managedTools = { shellcheck: null, shfmt: null };

const bashIdeSettings = (tools = managedTools) => {
  const diagnostics = setting("features.diagnostics");
  const format = setting("features.format");
  return {
    backgroundAnalysisMaxFiles: setting("bashIde.backgroundAnalysisMaxFiles"),
    enableSourceErrorDiagnostics: diagnostics && setting("bashIde.enableSourceErrorDiagnostics"),
    globPattern: setting("bashIde.globPattern"),
    explainshellEndpoint: setting("bashIde.explainshellEndpoint"),
    logLevel: setting("bashIde.logLevel"),
    includeAllWorkspaceSymbols: setting("bashIde.includeAllWorkspaceSymbols"),
    shellcheckArguments: setting("bashIde.shellcheckArguments") || [],
    shellcheckExternalSources: setting("bashIde.shellcheckExternalSources"),
    // The setting wins; otherwise the copy the editor installed, if there is
    // one; otherwise empty, which is how the server is told to search PATH.
    shellcheckPath: diagnostics ? setting("bashIde.shellcheckPath") || tools.shellcheck || "" : "",
    shfmt: {
      path: format ? setting("bashIde.shfmt.path") || tools.shfmt || "" : "",
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
      installServer,
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

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    const restart = () => {
      for (const session of service.getSessions()) {
        if (session.adapter !== adapter || ["stopping", "stopped"].includes(session.state))
          continue;
        service.restart(session).catch((error) => {
          lumine.notifications.addError("Unable to restart Bash Language Server", {
            detail: error.message,
            dismissable: true,
          });
        });
      }
    };
    for (const key of ["serverPath", "bashIde.logLevel"]) {
      subscriptions.add(lumine.config.onDidChange(`ide-bash.${key}`, restart));
    }
    return subscriptions;
  },
};
