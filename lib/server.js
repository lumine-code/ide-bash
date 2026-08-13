const fs = require("fs");
const path = require("path");

const SERVER_PACKAGE = "@lumine-code/bash-language-server";
const SERVER_ENTRY = `node_modules/${SERVER_PACKAGE}/server/out/cli.js`;

// This package needs three things, not one: the server, and the two external
// programs the server shells out to for diagnostics and formatting. The
// `managedServer` descriptor is one-server-per-adapter, so it cannot say that —
// which is exactly what `installServer` is for.
const SHELLCHECK_SYSTEMS = { darwin: "darwin", linux: "linux" };
const SHELLCHECK_ARCHITECTURES = { x64: "x86_64", arm64: "aarch64" };
const SHFMT_ARCHITECTURES = { x64: "amd64", arm64: "arm64", ia32: "386" };

// shellcheck publishes a .tar.gz beside every .tar.xz, so nothing here has to
// grow xz support; Windows gets a single zip covering every architecture.
exports.shellcheckAsset = ({ platform, arch, version }) => {
  if (platform === "win32") return `shellcheck-v${version}.zip`;
  const system = SHELLCHECK_SYSTEMS[platform];
  const architecture = SHELLCHECK_ARCHITECTURES[arch];
  return system && architecture ? `shellcheck-v${version}.${system}.${architecture}.tar.gz` : null;
};

// shfmt publishes the executable itself, with the version in the file name.
exports.shfmtAsset = ({ platform, arch, version }) => {
  const architecture = SHFMT_ARCHITECTURES[arch];
  const system = { win32: "windows", darwin: "darwin", linux: "linux" }[platform];
  if (!architecture || !system) return null;
  return `shfmt_v${version}_${system}_${architecture}${platform === "win32" ? ".exe" : ""}`;
};

const executable = (name) => (process.platform === "win32" ? `${name}.exe` : name);

// The two tools, relative to the install directory. Recorded in `install.json`
// so the settings can point the server at them without guessing the layout.
exports.toolPaths = (managed) =>
  managed?.directory
    ? {
        shellcheck: path.join(managed.directory, "tools", executable("shellcheck")),
        shfmt: path.join(managed.directory, "tools", executable("shfmt")),
      }
    : { shellcheck: null, shfmt: null };

// Fetches all three into the staging directory. Ordinary file work is done here
// rather than asked of the hub: an adapter reaching for `installServer` is
// exactly the case the hub cannot anticipate.
exports.installServer = async ({ storagePath, api }) => {
  const tools = path.join(storagePath, "tools");
  await fs.promises.mkdir(tools, { recursive: true });

  api.setServerInstallationStatus("downloading");
  const version = await api.npmPackageLatestVersion(SERVER_PACKAGE);

  const shellcheck = await api.latestGithubRelease("koalaman/shellcheck");
  const shellcheckName = exports.shellcheckAsset({
    platform: process.platform,
    arch: process.arch,
    version: shellcheck.version,
  });
  if (shellcheckName) {
    const asset = shellcheck.assets.find((entry) => entry.name === shellcheckName);
    if (asset) {
      const unpacked = path.join(tools, ".shellcheck");
      await api.downloadFile(asset.url, unpacked, {
        type: process.platform === "win32" ? "zip" : "gzip-tar",
      });
      // Both layouts put it one directory down, named for the release.
      await moveFound(
        unpacked,
        executable("shellcheck"),
        path.join(tools, executable("shellcheck")),
      );
      await fs.promises.rm(unpacked, { recursive: true, force: true });
      await api.makeFileExecutable(path.join(tools, executable("shellcheck")));
    }
  }

  const shfmt = await api.latestGithubRelease("mvdan/sh");
  const shfmtName = exports.shfmtAsset({
    platform: process.platform,
    arch: process.arch,
    version: shfmt.version,
  });
  const shfmtAsset = shfmtName && shfmt.assets.find((entry) => entry.name === shfmtName);
  if (shfmtAsset) {
    const target = path.join(tools, executable("shfmt"));
    await api.downloadFile(shfmtAsset.url, target);
    await api.makeFileExecutable(target);
  }

  api.setServerInstallationStatus("installing");
  await api.npmInstallPackage(SERVER_PACKAGE, version, storagePath);

  return { version, module: SERVER_ENTRY };
};

// Finds `name` anywhere in `root` and moves it to `target`. Release archives
// wrap the executable in a directory named for the version, which is not worth
// hard-coding when it can simply be looked for.
async function moveFound(root, name, target) {
  const walk = async (directory) => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === name) return candidate;
      if (entry.isDirectory()) {
        const found = await walk(candidate);
        if (found) return found;
      }
    }
    return null;
  };
  const found = await walk(root);
  if (!found) throw new Error(`The downloaded archive does not contain '${name}'.`);
  await fs.promises.copyFile(found, target);
}

exports.resolveServer = async (configuredPath, logLevel = "info", managed = null) => {
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
  // A copy the user asked the editor to install wins over it, and is launched
  // the same way.
  const serverModule =
    managed?.modulePath || require.resolve(`${SERVER_PACKAGE}/server/out/cli.js`);
  return {
    command: process.execPath,
    args: [serverModule, "start"],
    env: { ELECTRON_RUN_AS_NODE: "1", BASH_IDE_LOG_LEVEL: logLevel },
    version: managed?.version,
  };
};
