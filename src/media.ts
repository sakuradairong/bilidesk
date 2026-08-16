export function mediaSrc(url: string): string {
  if (!url) return "";
  const path = `img?u=${encodeURIComponent(url)}`;
  const windows = navigator.userAgent.includes("Windows");
  return windows ? `http://biliimg.localhost/${path}` : `biliimg://localhost/${path}`;
}
