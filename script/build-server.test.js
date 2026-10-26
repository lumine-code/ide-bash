const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { compileServer } = require("../lib/build-server");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bash-server-build-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src", "__tests__"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), '{"name":"bash-language-server"}');
  await fs.writeFile(path.join(root, "tree-sitter-bash.wasm"), "parser fixture");
  await fs.writeFile(path.join(root, "src", "get-options.sh"), "echo fixture");
  await fs.writeFile(path.join(root, "src", "__tests__", "ignored.ts"), "invalid syntax {{");
  return root;
}

test("builds pinned TypeScript and runtime assets atomically across concurrent preparations", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "src", "cli.ts"), "export const answer: number = 42;");
  const [first, second] = await Promise.all([
    compileServer(root, "pin"),
    compileServer(root, "pin"),
  ]);
  assert.equal(first, second);
  assert.equal(require(first).answer, 42);
  assert.equal(
    await fs.readFile(path.join(path.dirname(first), "get-options.sh"), "utf8"),
    "echo fixture",
  );
  assert.equal(
    await fs.readFile(path.join(path.dirname(first), "..", "tree-sitter-bash.wasm"), "utf8"),
    "parser fixture",
  );
  assert.equal(
    (await fs.readdir(root)).filter((name) => name.startsWith(".lumine-build-")).length,
    1,
  );
  assert.equal(await compileServer(root, "pin"), first);
});

test("rejects invalid sources without publishing a partial build and permits retry", async (t) => {
  const root = await fixture(t);
  const source = path.join(root, "src", "cli.ts");
  await fs.writeFile(source, "export const = ;");
  await assert.rejects(compileServer(root, "pin"));
  assert.equal(
    (await fs.readdir(root)).some((name) => name.startsWith(".lumine-build-")),
    false,
  );
  await fs.writeFile(source, "export const answer: number = 7;");
  assert.equal(require(await compileServer(root, "pin")).answer, 7);
});
