(() => {
  let host, button, selected = "", updateTimer, dismissTimer;
  function dismiss() {
    clearTimeout(updateTimer);
    clearTimeout(dismissTimer);
    host?.remove();
    host = button = null;
    selected = "";
  }

  function update() {
    const sel = window.getSelection();
    const insideEditor = node => (node?.nodeType === 1 ? node : node?.parentElement)
      ?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    const text = sel?.toString().trim();
    if (!text || !sel.rangeCount || insideEditor(sel.anchorNode) || insideEditor(sel.focusNode) ||
        insideEditor(document.activeElement)) return dismiss();
    if (host && selected === text) return;
    dismiss();
    selected = text;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    host = document.createElement("span");
    host.style.cssText = "all:initial!important;position:fixed!important;z-index:2147483647!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    button = document.createElement("button");
    button.textContent = "存入当前便签";
    button.style.cssText = "border:0;border-radius:7px;padding:7px 12px;background:#234d43;color:white;font:14px system-ui;cursor:pointer;box-shadow:0 2px 8px #0003;";
    shadow.append(button);
    document.documentElement.append(host);
    const left = Math.max(4, Math.min(rect.left, innerWidth - host.offsetWidth - 4)) + "px";
    const top = Math.max(4, Math.min(innerHeight - host.offsetHeight - 4,
      rect.top >= host.offsetHeight + 8 ? rect.top - host.offsetHeight - 6 : rect.bottom + 6)) + "px";
    host.style.setProperty("left", left, "important");
    host.style.setProperty("top", top, "important");
    button.onmousedown = event => event.preventDefault();
    button.onclick = async () => {
      const target = button;
      target.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: "capture", text });
        if (!result?.ok) throw new Error();
        if (target !== button) return;
        target.textContent = "已追加";
        dismissTimer = setTimeout(dismiss, 900);
      } catch {
        target.disabled = false;
        target.textContent = "保存失败，点击重试";
      }
    };
  }
  document.addEventListener("selectionchange", () => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 80);
  });
  document.addEventListener("pointerdown", event => {
    if (host && !event.composedPath().includes(host)) dismiss();
  }, true);
  document.addEventListener("scroll", dismiss, true);
  window.addEventListener("blur", dismiss);
})();
