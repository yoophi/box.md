// WKWebView clears its visible Selection when another WebView becomes first responder.
// Keep the last focused selection and live ranges, without sending page data over IPC.
(() => {
  let captured = null;
  const remember = () => {
    if (!document.hasFocus()) return;
    const selection = window.getSelection();
    const text = selection?.toString() ?? "";
    captured = text ? {
      text: text.slice(0, 262145),
      ranges: Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()),
    } : null;
  };
  document.addEventListener("selectionchange", remember);
  document.addEventListener("pointerdown", () => { captured = null; }, true);
  window.addEventListener("pagehide", () => { captured = null; });
  Object.defineProperty(window, "__boxReadSiteSelection", { value: () => {
    const current = window.getSelection()?.toString() ?? "";
    if (current || document.hasFocus()) return current;
    if (!captured || !captured.ranges.some((range) => range.commonAncestorContainer.isConnected && range.toString())) return "";
    return captured.text;
  }});
})();
