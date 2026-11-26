const { launchExtension } = require("./browser.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const http = require("node:http");
const { once } = require("node:events");


test("跨页摘录、并发编辑、当前便签切换及重启恢复", { timeout: 60000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "kitten-notes-"));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>一段网页资料</p><textarea>输入区域</textarea>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let context;
  t.after(async () => {
    await context?.close();
    server.close();
    await fs.rm(profile, { recursive: true, force: true });
  });
  async function launch() {
    const instance = await launchExtension(profile);
    context = instance.context;
    return instance.panelUrl;
  }
  const panelUrl = await launch();
  const site = "http://127.0.0.1:" + server.address().port;
  async function pageFor(route) {
    const page = await context.newPage();
    await page.goto(site + route);
    assert.equal(await page.locator("html > span").count(), 0);
    return page;
  }
  async function clip(page) {
    await page.bringToFront();
    await page.locator("p").click();
    await page.locator("p").evaluate(p => window.getSelection().selectAllChildren(p));
    await page.locator("html > span").click();
  }
  const a = await pageFor("/a");
  const b = await pageFor("/b");
  await clip(a);
  await clip(b);
  const panel = await context.newPage();
  await panel.goto(panelUrl);
  const expected = "> 一段网页资料\n\n> 一段网页资料";
  await panel.waitForFunction(text => document.querySelector("#body").value === text, expected);
  // Race a fresh append with an edit based on the previously visible body.
  await clip(a);
  await panel.waitForFunction(text => document.querySelector("#body").value === text,
    expected + "\n\n> 一段网页资料");
  const id = await panel.evaluate(async () => (await chrome.storage.local.get("notebook")).notebook.current);
  const edit = await panel.evaluate(({ id, expected }) =>
    chrome.runtime.sendMessage({ type: "edit", id, field: "body", before: expected, after: "手写整理" }),
    { id, expected });
  assert.equal(edit.ok, true);
  await panel.waitForFunction(() => document.querySelector("#body").value === "手写整理\n\n> 一段网页资料");
  await panel.locator("#create").click();
  await panel.waitForFunction(() => document.querySelector("#body").value === "");
  for (let repeat = 0; repeat < 4; repeat++) await panel.locator("#create").click();
  const draft = await panel.evaluate(async () => (await chrome.storage.local.get("notebook")).notebook);
  assert.equal(draft.notes.length, 1);
  assert.equal(draft.current, null);
  assert.ok(draft.draftId);
  await clip(b);
  await panel.waitForFunction(() => document.querySelector("#body").value === "> 一段网页资料");
  await panel.locator("#title").fill("第二张");
  await panel.locator("#historyToggle").click();
  await panel.locator("#search").fill("手写整理");
  await panel.locator("#results .open-note").click();
  await panel.waitForFunction(() => document.querySelector("#body").value.startsWith("手写整理"));
  await clip(b);
  await panel.waitForFunction(() => document.querySelector("#body").value === "手写整理\n\n> 一段网页资料\n\n> 一段网页资料");
  await panel.locator("#body").fill("关闭前的最后一次输入");
  await panel.close();
  await context.close();
  context = null;
  const restoredUrl = await launch();
  const restored = await context.newPage();
  await restored.goto(restoredUrl);
  await restored.waitForFunction(() => document.querySelector("#body").value === "关闭前的最后一次输入");
  const book = await restored.evaluate(async () => (await chrome.storage.local.get("notebook")).notebook);
  assert.equal(book.current, id);
  assert.equal(book.notes.length, 2);
  assert.equal(book.notes.find(note => note.id === id).url, site + "/b");
});
