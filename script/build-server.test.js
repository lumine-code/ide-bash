const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRequire } = require("node:module");
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

test("prepares nested CommonJS modules without reading upstream monorepo configuration", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "tsconfig.json"), '{"extends":"../missing-config.json"}');
  await fs.mkdir(path.join(root, "src", "nested"));
  await fs.writeFile(
    path.join(root, "src", "nested", "value.ts"),
    "export const enum Answer { value = 42 }",
  );
  await fs.writeFile(
    path.join(root, "src", "cli.ts"),
    'import { Answer } from "./nested/value"; export const answer: number = Answer.value;',
  );
  assert.equal(require(await compileServer(root, "pin")).answer, 42);
});

test("preserves the server's EditorConfig shell globs and escaped project paths", () => {
  const serverRequire = createRequire(require.resolve("bash-language-server/package.json"));
  const { parseFromFilesSync } = serverRequire("editorconfig");
  const root = path.resolve(os.tmpdir(), "bash-[project]");
  const configs = [
    {
      name: path.join(root, ".editorconfig"),
      contents: Buffer.from(
        "root = true\n[*]\nend_of_line = lf\n[*.{sh,bash}]\nindent_style = space\nindent_size = 4\n[nested/**.sh]\nindent_size = 2\n",
      ),
    },
  ];
  const parse = (file) => parseFromFilesSync(path.join(root, file), configs);
  assert.deepEqual(parse("script.bash"), {
    end_of_line: "lf",
    indent_style: "space",
    indent_size: 4,
    tab_width: 4,
  });
  assert.equal(parse(path.join("nested", "script.sh")).indent_size, 2);
  assert.equal(parse(".hidden.sh").indent_size, 4);
  assert.deepEqual(parse("readme.md"), { end_of_line: "lf" });
});
