const { CompositeDisposable } = require("lumine");
const { resolveServer } = require("./server");

const setting = (key) => lumine.config.get(`ide-bash.${key}`);

const bashIdeSettings = () => {
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
    shellcheckPath: diagnostics ? setting("bashIde.shellcheckPath") : "",
    shfmt: {
      path: format ? setting("bashIde.shfmt.path") : "",
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
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), setting("bashIde.logLevel"));
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getSettings() {
        return { bashIde: bashIdeSettings() };
      },
      getWorkspaceConfiguration(section) {
        if (!section) return { bashIde: bashIdeSettings() };
        return section === "bashIde" ? bashIdeSettings() : undefined;
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
