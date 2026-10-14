// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [
    "language-shellscript",
    "marker",
    "linter",
    "linter-panel",
    "documentation-view",
    "hover",
    "ide",
  ],
  viewport: { width: 1100, height: 490 },
  async before(context) {
    const { lumine, state } = context;
    for (const p of lumine.packages.getActivePackages())
      if (
        p.name.startsWith("ide-") &&
        p.name !== "ide-bash" &&
        state.serverInstall?.[p.name]?.status !== "installing"
      )
        await lumine.packages.deactivatePackage(p.name);
  },
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("ide-bash/process.sh");
    await lumine.project.setPaths([fixture("ide-bash")]);
    lumine.grammars.assignLanguageMode(state.editor.getBuffer(), "source.shell");
    await state.editor.getBuffer().getLanguageMode().ready;
    await state.editor.getBuffer().getLanguageMode().atGrammarSettlement?.();
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Bash hover information resolves a shell variable to its assigned value.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          for (let n = 0; n < 60; n++) {
            if (
              [
                ...lumine.packages.getActivePackage("ide").mainModule.manager.sessions.values(),
              ].some((s) => s.adapter.id === "ide-bash" && s.state === "running")
            )
              break;
            await new Promise((r) => setTimeout(r, 500));
          }
          if (
            ![...lumine.packages.getActivePackage("ide").mainModule.manager.sessions.values()].some(
              (s) => s.adapter.id === "ide-bash" && s.state === "running",
            )
          )
            throw new Error("The actual language server did not start");
          state.editor.setCursorBufferPosition([7, 9]);
          lumine.views.getView(state.editor).focus();
        }
      },
      async afterPointerMove(context) {
        const { lumine, state } = context;
        lumine.commands.dispatch(lumine.views.getView(state.editor), "hover:dismiss");
        lumine.commands.dispatch(lumine.views.getView(state.editor), "hover:toggle");
      },
      ready() {
        return Boolean(
          (() => {
            const e = document.querySelector("lumine-overlay.hover-overlay");
            const r = e?.getBoundingClientRect();
            return e?.innerText.includes("samples") && r.top >= 36 && r.bottom <= innerHeight - 24;
          })(),
        );
      },
    },
  ],
  async cleanup() {},
};
