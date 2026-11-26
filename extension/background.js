const key = "notebook";
const clipMenu = "clip-selection";
let writes = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: clipMenu, title: "存入当前便签", contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
  });
});

// Both clipping paths and editor windows write through this queue.
function change(operation) {
  const task = writes.then(async () => {
    const stored = await chrome.storage.local.get(key);
    const book = stored[key] || { notes: [], current: null };
    if (book.groups) {
      delete book.groups;
      for (const note of book.notes) delete note.groupId;
    }
    operation(book);
    await chrome.storage.local.set({ [key]: book });
  });
  writes = task.catch(() => {});
  return task;
}

function newNote(book, title = "", id = crypto.randomUUID()) {
  const now = Date.now();
  const note = { id, title, body: "", url: "", createdAt: now, updatedAt: now };
  book.notes.unshift(note);
  book.current = note.id;
  delete book.draftId;
  return note;
}

function capture(text, url) {
  const excerpt = String(text || "").trim();
  if (!excerpt) throw new Error("请先选中文字");
  return change(book => {
    const note = book.notes.find(item => item.id === book.current) ||
      newNote(book, Array.from(excerpt.split(/\r?\n/)[0]).slice(0, 20).join(""), book.draftId);
    const quote = excerpt.split(/\r?\n/).map(line => "> " + line).join("\n");
    note.body += (note.body ? "\n\n" : "") + quote;
    note.url = url;
    note.updatedAt = Date.now();
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === clipMenu && info.selectionText?.trim()) {
    capture(info.selectionText, info.frameUrl || info.pageUrl || tab?.url || "")
      .catch(error => console.error("右键摘录保存失败", error));
  }
});

function panelAction(message) {
  return change(book => {
    if (message.type === "new" || message.type === "prepareDraft") {
      if (message.type === "new" || !book.current) {
        book.current = null;
        book.draftId ??= crypto.randomUUID();
      }
      return;
    }
    let note = book.notes.find(item => item.id === message.id);
    if (!note && message.type === "edit" && message.id === book.draftId) {
      note = newNote(book, "", message.id);
    }
    if (!note) throw new Error("便签不存在");
    if (message.type === "select") {
      book.current = note.id;
      delete book.draftId;
      return;
    }
    if (message.type === "deleteNote") {
      book.notes = book.notes.filter(item => item.id !== note.id);
      if (book.current === note.id) {
        const latest = book.notes.reduce((best, item) =>
          !best || item.updatedAt > best.updatedAt ? item : best, null);
        book.current = latest?.id ?? null;
        if (!latest) book.draftId = crypto.randomUUID();
      }
      return;
    }
    const { field, before, after } = message;
    if (message.type !== "edit" || !["body", "title"].includes(field) ||
        typeof before !== "string" || typeof after !== "string") throw new Error("无法保存此编辑");
    // New captures can have arrived since this editor displayed the text.
    // Retain their exact suffix, including intentional duplicate excerpts.
    const stored = note[field];
    if (stored === before) note[field] = after;
    else if (field === "body" && stored.startsWith(before) &&
             /^(?:\n\n)?> /.test(stored.slice(before.length))) {
      const suffix = stored.slice(before.length).replace(/^\n\n/, "");
      note.body = after + (after ? "\n\n" : "") + suffix;
    } else throw new Error("另一窗口已修改此便签，请先复制草稿后重新打开");
    note.updatedAt = Date.now();
  });
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let task;
  if (message.type === "capture" && /^https?:\/\//.test(sender.url) && message.text?.trim()) {
    task = capture(message.text, sender.url);
  } else if (sender.url === chrome.runtime.getURL("panel.html")) {
    task = panelAction(message);
  } else return;
  task.then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
  return true;
});
