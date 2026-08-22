import { afterEach, describe, expect, it, vi } from "vitest";

import { mediaSrc } from "./media";

afterEach(() => vi.unstubAllGlobals());

describe("mediaSrc", () => {
  it("uses the Windows custom protocol host in WebView2", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    expect(mediaSrc("https://i0.hdslb.com/image a.jpg")).toBe(
      "http://biliimg.localhost/img?u=https%3A%2F%2Fi0.hdslb.com%2Fimage%20a.jpg",
    );
  });

  it("uses the native custom protocol elsewhere and preserves empty values", () => {
    vi.stubGlobal("navigator", { userAgent: "Linux" });
    expect(mediaSrc("https://example.com/a.jpg")).toBe(
      "biliimg://localhost/img?u=https%3A%2F%2Fexample.com%2Fa.jpg",
    );
    expect(mediaSrc("")).toBe("");
  });
});
