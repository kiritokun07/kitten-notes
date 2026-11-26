// Identifiers are stored in the backup; only display names become ZIP paths.
function fileStem(value, fallback) {
  const clean = (value || fallback).normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  const short = Array.from(clean).slice(0, 56).join("").replace(/[. ]+$/, "") || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(short) ? "_" + short : short;
}

function uniqueStem(stem, used) {
  let result = stem;
  for (let n = 2; used.has(result.toLowerCase()); n++) result = stem + " (" + n + ")";
  used.add(result.toLowerCase());
  return result;
}

function exportZip(book) {
  const files = Object.create(null);
  const filenames = new Set();
  const notes = book.notes.map(({ groupId, ...note }) => note);
  for (const note of notes) {
    const name = uniqueStem(fileStem(note.title || note.body.trim().split(/\r?\n/)[0], "未命名便签"), filenames);
    const source = note.url ? "\n\n最近摘录来源：" + note.url : "";
    files[name + ".md"] = fflate.strToU8(note.body + source + "\n");
  }
  const backup = { version: 2, exportedAt: new Date().toISOString(), notes, current: book.current };
  files["backup.json"] = fflate.strToU8(JSON.stringify(backup, null, 2));
  return new Blob([fflate.zipSync(files)], { type: "application/zip" });
}
