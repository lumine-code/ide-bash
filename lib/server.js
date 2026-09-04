const fs = require("fs");
const path = require("path");

const SERVER_PACKAGE = "@lumine-code/bash-language-server";
const SHELLCHECK_REPOSITORY = "koalaman/shellcheck";
const SHFMT_REPOSITORY = "mvdan/sh";

// The maintained server fork ships with the adapter and has no registry or
// release artifact. The managed payload is therefore the two external tools it
// shells out to, never an invented remote copy of the server.
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

const versionParts = (version, name) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).replace(/^v/, ""));
  if (!match) throw new Error(`${name} published an unsupported version '${version}'.`);
  return match.slice(1);
};

exports.toolchainVersion = ({ shellcheck, shfmt }) =>
  [...versionParts(shellcheck.version, "ShellCheck"), ...versionParts(shfmt.version, "shfmt")].join(
    ".",
  );

const releasesForVersion = async (api, version) => {
  if (!version)
    return Promise.all([
      api.latestGithubRelease(SHELLCHECK_REPOSITORY),
      api.latestGithubRelease(SHFMT_REPOSITORY),
    ]).then(([shellcheck, shfmt]) => ({ shellcheck, shfmt }));
  const parts = String(version).split(".");
  if (parts.length !== 6 || parts.some((part) => !/^\d+$/.test(part)))
    throw new Error(`Unsupported Bash toolchain version '${version}'.`);
  const shellcheckVersion = parts.slice(0, 3).join(".");
  const shfmtVersion = parts.slice(3).join(".");
  return Promise.all([
    api.githubReleaseByTag(SHELLCHECK_REPOSITORY, `v${shellcheckVersion}`),
    api.githubReleaseByTag(SHFMT_REPOSITORY, `v${shfmtVersion}`),
  ]).then(([shellcheck, shfmt]) => ({ shellcheck, shfmt }));
};

exports.latestServerVersion = async (api) =>
  exports.toolchainVersion(await releasesForVersion(api, null));

const requiredAsset = (release, name, tool) => {
  if (!name) throw new Error(`${tool} publishes no build for ${process.platform}-${process.arch}.`);
  const asset = release.assets.find((entry) => entry.name === name);
  if (!asset) throw new Error(`${tool} ${release.version} has no '${name}' release asset.`);
  if (!asset.digest)
    throw new Error(`${tool} ${release.version} published no digest for '${name}'.`);
  return asset;
};

exports.installServer = async ({ storagePath, version, api }) => {
  const tools = path.join(storagePath, "tools");
  await fs.promises.mkdir(tools, { recursive: true });

  api.setServerInstallationStatus("downloading");
  const releases = await releasesForVersion(api, version);
  const { shellcheck, shfmt } = releases;
  const shellcheckName = exports.shellcheckAsset({
    platform: process.platform,
    arch: process.arch,
    version: shellcheck.version,
  });
  const shellcheckAsset = requiredAsset(shellcheck, shellcheckName, "ShellCheck");
  const shfmtName = exports.shfmtAsset({
    platform: process.platform,
    arch: process.arch,
    version: shfmt.version,
  });
  const shfmtAsset = requiredAsset(shfmt, shfmtName, "shfmt");

  const unpacked = path.join(tools, ".shellcheck");
  await api.downloadFile(shellcheckAsset.url, unpacked, {
    type: process.platform === "win32" ? "zip" : "gzip-tar",
    digest: shellcheckAsset.digest,
  });
  // Every ShellCheck archive wraps the executable in its release directory.
  const shellcheckTarget = path.join(tools, executable("shellcheck"));
  await moveFound(unpacked, executable("shellcheck"), shellcheckTarget);
  await fs.promises.rm(unpacked, { recursive: true, force: true });
  await api.makeFileExecutable(shellcheckTarget);

  const shfmtTarget = path.join(tools, executable("shfmt"));
  await api.downloadFile(shfmtAsset.url, shfmtTarget, { digest: shfmtAsset.digest });
  await api.makeFileExecutable(shfmtTarget);

  api.setServerInstallationStatus("installing");
  return {
    version: exports.toolchainVersion(releases),
    tools: { shellcheck: shellcheck.version, shfmt: shfmt.version },
  };
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

exports.resolveServer = async (configuredPath, logLevel = "info", _managed = null) => {
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
  // Managed installation carries only external tools. The audited fork remains
  // the server regardless of whether that toolchain is present.
  const serverModule = require.resolve(`${SERVER_PACKAGE}/server/out/cli.js`);
  return {
    command: process.execPath,
    args: [serverModule, "start"],
    env: { ELECTRON_RUN_AS_NODE: "1", BASH_IDE_LOG_LEVEL: logLevel },
    version: require(`${SERVER_PACKAGE}/package.json`).version,
  };
};
