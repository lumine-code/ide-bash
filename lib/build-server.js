const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);

let building;

async function compileServer(packageRoot, sourcePin) {
  const compiler = require("typescript/package.json");
  const compilerPath = path.resolve(
    path.dirname(require.resolve("typescript/package.json")),
    compiler.bin.tsc,
  );
  const fingerprint = createHash("sha256")
    .update(`${sourcePin}\n${compiler.version}\nnode16-cli`)
    .digest("hex");
  const destination = path.join(packageRoot, `.lumine-build-${fingerprint}`);
  const cli = path.join(destination, "out", "cli.js");
  try {
    await fs.access(cli);
    return cli;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Publish a complete build atomically. Separate editor windows can prepare
  // the same immutable source concurrently without seeing partial output.
  const temporary = `${destination}-${randomUUID()}.tmp`;
  if (path.dirname(temporary) !== path.resolve(packageRoot))
    throw new Error("The temporary server build escaped its package directory.");
  await fs.mkdir(path.join(temporary, "out"), { recursive: true });
  try {
    const sources = [];
    async function collect(directory, relative = "") {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const source = path.join(directory, entry.name);
        const target = path.join(temporary, "out", relative, entry.name);
        if (entry.isDirectory()) {
          await fs.mkdir(target, { recursive: true });
          await collect(source, path.join(relative, entry.name));
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          sources.push(source);
        } else if (!entry.name.endsWith(".d.ts")) {
          await fs.copyFile(source, target);
        }
      }
    }
    await collect(path.join(packageRoot, "src"));
    const configPath = path.join(temporary, "tsconfig.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        files: sources,
        compilerOptions: {
          rootDir: path.join(packageRoot, "src"),
          outDir: path.join(temporary, "out"),
          module: "node16",
          moduleResolution: "node16",
          target: "es2022",
          esModuleInterop: true,
          isolatedModules: true,
          noCheck: true,
          noResolve: true,
          noEmitOnError: true,
          types: [],
        },
      }),
    );
    // TypeScript 7 exposes its compiler through the CLI. Keep preparation
    // isolated from upstream's monorepo config and report syntax failures.
    await run(process.execPath, [compilerPath, "--project", configPath, "--pretty", "false"], {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }).catch((error) => {
      throw new Error(String(error.stdout || error.stderr || error.message).trim(), {
        cause: error,
      });
    });
    for (const filename of ["package.json", "tree-sitter-bash.wasm"])
      await fs.copyFile(path.join(packageRoot, filename), path.join(temporary, filename));
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      // A concurrent complete build wins. Any other rename error remains an
      // operation failure, including an incomplete or unwritable destination.
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      await fs.access(cli);
    }
    return cli;
  } finally {
    // Both paths are direct children of the dependency we resolved above.
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

function bundledServerPath() {
  if (!building) {
    const packageRoot = path.dirname(require.resolve("bash-language-server/package.json"));
    const pin = require("../package.json").dependencies["bash-language-server"];
    building = compileServer(packageRoot, pin).catch((error) => {
      building = null;
      throw error;
    });
  }
  return building;
}

module.exports = { bundledServerPath, compileServer };

if (require.main === module)
  bundledServerPath().then(
    (cli) => console.log(cli),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
