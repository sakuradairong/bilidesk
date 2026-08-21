export function isHotkeyIgnored(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return true;
  if (el.closest('[role="dialog"]')) return true;
  if (el.getAttribute("role") === "slider") return true;
  return false;
}
