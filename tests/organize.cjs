const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { launchExtension } = require("./browser.cjs");
const { unzipSync, strFromU8 } = require("../extension/vendor/fflate-0.8.3.min.js");

test("直接写便签、旧版数据兼容、搜索、全部导出及删除", { timeout: 60000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kitten-library-"));
  const { context, panelUrl } = await launchExtension(dir);
  t.after(async () => {
    await context.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const page = await context.newPage();
  await page.goto(panelUrl);
  assert.equal(await page.locator("#downloadZip").isDisabled(), true);
  await page.waitForFunction(() => document.activeElement.id === "body");
  await page.keyboard.insertText("直接写下第一张便签");
  await page.waitForFunction(async () => (await chrome.storage.local.get("notebook")).notebook?.notes[0].body === "直接写下第一张便签");
  await page.locator("#body").evaluate(el => el.setSelectionRange(3, 3));
  await page.reload();
  await page.waitForFunction(() => document.activeElement.id === "body");
  assert.equal(await page.locator("#body").evaluate(el => el.selectionStart), 3);
  const base = { title: "项目摘录", body: "会议纪要", createdAt: 1, updatedAt: 1, url: "" };
  const first = { ...base, id: "a", groupId: "work", url: "https://example.org/minutes",
    body: "# 会议纪要\n\n> 原文\n\n**重点**\n\n![外部图片](https://example.org/private.png)\n\n<script>bad()</script>" };
  await page.evaluate(book => chrome.storage.local.set({notebook: book}), {
    groups: [{ id: "work", name: "旧分组" }], current: "a", notes: [first, { ...base, id: "b", updatedAt: 3 },
      { ...base, id: "c", title: "私人", body: "家庭纪要", updatedAt: 2 }]
  });
  await page.locator("#previewMode").click();
  assert.equal(await page.locator("#preview h1").innerText(), "会议纪要");
  assert.equal(await page.locator("#preview strong").innerText(), "重点");
  assert.equal(await page.locator("#preview blockquote").innerText(), "原文");
  assert.equal(await page.locator("#preview img, #preview script").count(), 0);
  await page.locator("#previewMode").click();
  assert.equal(await page.locator("#body").inputValue(), first.body);

  await page.locator("#historyToggle").click();
  await page.locator("#search").fill("会议纪要");
  assert.equal(await page.locator("#results li").count(), 2);
  const transfer = page.waitForEvent("download");
  await page.getByRole("button", {name: "导出全部便签"}).click();
  const zip = unzipSync(await fs.readFile(await (await transfer).path()));
  assert.deepEqual(Object.keys(zip).sort(), ["backup.json", "项目摘录 (2).md", "项目摘录.md", "私人.md"].sort());
  const backup = JSON.parse(strFromU8(zip["backup.json"]));
  const { groupId, ...plainFirst } = first;
  assert.deepEqual(backup.notes[0], plainFirst);
  assert.deepEqual(backup.notes.map(n => n.id), ["a", "b", "c"]);
  assert.equal(backup.current, "a");
  assert.ok(!("groups" in backup));
  assert.match(strFromU8(zip["项目摘录.md"]), /最近摘录来源：https:\/\/example.org\/minutes/);

  const current = page.locator("#results li").filter({hasText: "当前 ·"});
  await current.getByRole("button", {name: "删除"}).click();
  await page.locator("#cancelDelete").click();
  assert.equal(await page.locator("#results li").count(), 2);
  await current.getByRole("button", {name: "删除"}).click();
  await page.locator("#confirmAction").click();
  await page.waitForFunction(async () => (await chrome.storage.local.get("notebook")).notebook.current === "b");
  assert.equal(await page.locator("#results li").count(), 1);
});
