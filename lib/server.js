const fs = require("fs");

exports.resolveServer = async (configuredPath, logLevel = "info") => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return {
      command: configuredPath,
      args: ["start"],
      env: { BASH_IDE_LOG_LEVEL: logLevel },
    };
  }

  // The exact server dependency ships with this package. Invoking its module
  // through the editor's Node executable avoids platform-specific .bin shims.
  const serverModule = require.resolve("@lumine-code/bash-language-server/server/out/cli.js");
  return {
    command: process.execPath,
    args: [serverModule, "start"],
    env: { ELECTRON_RUN_AS_NODE: "1", BASH_IDE_LOG_LEVEL: logLevel },
  };
};
