const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

let building;

async function compileServer(packageRoot, sourcePin) {
  const ts = require("typescript");
  const fingerprint = createHash("sha256").update(`${sourcePin}\n${ts.version}`).digest("hex");
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
    async function compile(directory, relative = "") {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const source = path.join(directory, entry.name);
        const target = path.join(temporary, "out", relative, entry.name);
        if (entry.isDirectory()) {
          await fs.mkdir(target, { recursive: true });
          await compile(source, path.join(relative, entry.name));
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          const result = ts.transpileModule(await fs.readFile(source, "utf8"), {
            fileName: path.join(relative, entry.name),
            reportDiagnostics: true,
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
              esModuleInterop: true,
            },
          });
          const errors = result.diagnostics.filter(
            ({ category }) => category === ts.DiagnosticCategory.Error,
          );
          if (errors.length)
            throw new Error(
              errors
                .map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, "\n"))
                .join("\n"),
            );
          await fs.writeFile(target.replace(/\.ts$/, ".js"), result.outputText);
        } else if (!entry.name.endsWith(".d.ts")) {
          await fs.copyFile(source, target);
        }
      }
    }
    await compile(path.join(packageRoot, "src"));
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
