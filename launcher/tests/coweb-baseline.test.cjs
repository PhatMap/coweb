const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveLauncherProfile } = require("../electron/profile.cjs");
const { createUpdateController } = require("../electron/update.cjs");

test("CoWeb profiles ignore inherited upstream storage overrides", () => {
  const homeDir = path.resolve("isolated-home");
  const appData = path.join(homeDir, "app-data");
  const env = {
    CODEX_CHATGPT_WEB_HOME: path.join(homeDir, "upstream"),
    CODEX_WEB_GPT_DEV_HOME: path.join(homeDir, "upstream-dev"),
    CODEX_WEB_GPT_LAUNCHER_DATA_DIR: path.join(homeDir, "upstream-electron"),
  };
  const production = resolveLauncherProfile({ argv: [], env, homeDir, appData });
  const development = resolveLauncherProfile({ argv: ["--dev-profile"], env, homeDir, appData });
  assert.equal(production.displayName, "CoWeb");
  assert.equal(production.coreHome, path.join(homeDir, ".coweb"));
  assert.equal(production.userData, path.join(appData, "CoWeb"));
  assert.equal(development.displayName, "CoWeb DEV");
  assert.equal(development.coreHome, path.join(homeDir, ".coweb-dev"));
  assert.notEqual(production.browserPartition, development.browserPartition);
  assert.equal(production.browserPartition, "persist:coweb-chatgpt");
  assert.equal(development.browserPartition, "persist:coweb-dev-chatgpt");
});

test("packaged CoWeb has no update source until a release repository is configured", async () => {
  const controller = createUpdateController({
    currentVersion: "5.0.6", platform: "win32", arch: "x64", packaged: true,
  });
  assert.deepEqual(controller.getState(), { status: "disabled" });
  assert.deepEqual(await controller.checkOnce(), { status: "disabled" });
  await assert.rejects(controller.beginInstall(), /No launcher update is available/);
});
