const byId = id => document.getElementById(id);
const title = byId("title");
const body = byId("body");
const statusLine = byId("status");
const markdown = markdownit({ html: false });
markdown.validateLink = href => /^(https?:\/\/|mailto:)/i.test(href);
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || "图片");
let book = { notes: [], current: null };
let previewing = false;
let active = null;
let displayed = { title: "", body: "" };
let generation = 0;
let pending = 0;
let failed = false;

async function render() {
  const version = ++generation;
  const { notebook } = await chrome.storage.local.get("notebook");
  if (version !== generation || pending || failed) return;
  book = notebook || { notes: [], current: null };
  const note = book.notes.find(item => item.id === book.current);
  active = note?.id || null;
  byId("downloadZip").disabled = !book.notes.length;
  if (!byId("history").hidden) renderHistory();
  // Leave the caret and IME composition alone when storage echoes our own edit.
  for (const field of [title, body]) {
    const value = note?.[field.id] || "";
    if (field.value !== value) field.value = value;
  }
  displayed = { title: title.value, body: body.value };
  if (previewing) renderPreview();
  statusLine.textContent = note ? "已保存" : "";
}

async function send(message) {
  pending++;
  byId("downloadZip").disabled = true;
  generation++;
  statusLine.textContent = "保存中…";
  let errorMessage = "";
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "保存失败");
  } catch (error) {
    if (message.type !== "edit") {
      errorMessage = error.message;
      return false;
    }
    failed = true;
    byId("create").disabled = byId("historyToggle").disabled = true;
    body.readOnly = title.readOnly = true;
    statusLine.textContent = "保存失败，请复制草稿后重新打开。 " + error.message;
    return false;
  } finally {
    pending--;
    if (!pending && !failed) await render();
    if (errorMessage) statusLine.textContent = errorMessage;
  }
  return true;
}

for (const field of [title, body]) {
  field.addEventListener("input", () => {
    const before = displayed[field.id];
    displayed[field.id] = field.value;
    // Dispatch before the input handler returns, even if the panel closes next.
    active ??= book.draftId;
    send({ type: "edit", id: active, field: field.id, before, after: field.value });
  });
}

async function switchNote(message) {
  byId("workspace").inert = byId("history").inert = true;
  byId("create").disabled = true;
  const ok = await send(message);
  byId("workspace").inert = byId("history").inert = false;
  byId("create").disabled = failed;
  if (ok) {
    setPreview(false);
    showHistory(false);
    focusBody();
  }
}
byId("create").onclick = () => {
  if (active) return switchNote({ type: "new" });
  setPreview(false);
  showHistory(false);
  body.focus();
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.notebook && !pending) render();
});

function renderPreview() {
  byId("preview").innerHTML = markdown.render(body.value);
  if (!body.value.trim()) byId("preview").textContent = "正文为空";
}

function setPreview(value) {
  previewing = value;
  body.hidden = value;
  byId("preview").hidden = !value;
  byId("previewMode").textContent = value ? "继续编辑" : "预览";
  byId("previewMode").setAttribute("aria-pressed", String(value));
  if (value) renderPreview();
}

byId("previewMode").onclick = () => {
  setPreview(!previewing);
  if (!previewing) body.focus();
};

function showHistory(open) {
  byId("workspace").hidden = open;
  byId("history").hidden = !open;
  byId("historyToggle").textContent = open ? "返回编辑" : "全部便签";
  if (open) {
    byId("search").value = "";
    renderHistory();
    byId("search").focus();
  }
}
byId("historyToggle").onclick = () => {
  showHistory(byId("history").hidden);
  if (byId("history").hidden) (previewing ? byId("previewMode") : body).focus();
};

function makeButton(text, onClick, className = "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.onclick = onClick;
  return button;
}

function line(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });
function renderHistory() {
  const query = byId("search").value.trim().toLocaleLowerCase();
  const list = book.notes.filter(note => (note.title + "\n" + note.body).toLocaleLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const rows = list.map(note => {
    const item = document.createElement("li");
    const name = note.title || note.body.trim().split(/\r?\n/)[0] || "未命名便签";
    const open = makeButton("", () => switchNote({ type: "select", id: note.id }), "open-note");
    open.setAttribute("aria-label", name);
    open.append(line("strong", "", name), line("span", "snippet", note.body.replace(/\s+/g, " ")),
      line("span", "meta", (note.id === active ? "当前 · " : "") + dateFormat.format(note.updatedAt)));
    item.append(open, makeButton("删除", () => {
      deleteId = note.id;
      byId("actionText").textContent = "确定删除「" + name + "」？";
      byId("actionDialog").showModal();
    }));
    return item;
  });
  byId("results").replaceChildren(...rows);
  byId("noResults").textContent = query ? "没有找到匹配的便签" : "还没有便签";
  byId("noResults").hidden = !!rows.length;
}
byId("search").oninput = renderHistory;
let deleteId;
byId("cancelDelete").onclick = () => byId("actionDialog").close();
byId("confirmAction").onclick = async () => {
  byId("confirmAction").disabled = true;
  if (await send({ type: "deleteNote", id: deleteId })) byId("actionDialog").close();
  byId("confirmAction").disabled = false;
};

byId("downloadZip").onclick = () => {
  try {
    const blob = exportZip(book);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "小猫便签-" + new Date().toLocaleDateString("sv-SE") + ".zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    statusLine.textContent = "已导出 " + book.notes.length + " 张便签";
  } catch (error) {
    statusLine.textContent = error.message;
  }
};

// Remember just the last editing position, without storing any note text.
function rememberCaret() {
  if (active) localStorage.setItem("lastCaret", JSON.stringify([active, body.selectionStart, body.selectionEnd]));
}
body.addEventListener("blur", rememberCaret);
window.addEventListener("pagehide", () => {
  if (document.activeElement === body) rememberCaret();
});

function focusBody() {
  const [id, start, end] = JSON.parse(localStorage.getItem("lastCaret") || "[]");
  body.focus();
  if (active && active === id) body.setSelectionRange(start, end);
  else body.setSelectionRange(body.value.length, body.value.length);
}

async function openEditor() {
  const { notebook } = await chrome.storage.local.get("notebook");
  if (!notebook?.current && !notebook?.draftId) {
    const reply = await chrome.runtime.sendMessage({ type: "prepareDraft" });
    if (!reply?.ok) throw new Error(reply?.error || "无法打开草稿");
  }
  await render();
  byId("workspace").inert = false;
  focusBody();
}
openEditor().catch(error => { statusLine.textContent = error.message; });
