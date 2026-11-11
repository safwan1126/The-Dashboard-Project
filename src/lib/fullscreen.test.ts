import { describe, expect, it, vi } from "vitest";
import { enterFullscreen, fullscreenElement, leaveFullscreen } from "./fullscreen";

// Just enough of a Document to stand in for one browser's dialect.
function fakeDocument(parts: { root?: object; doc?: object }) {
  return { documentElement: parts.root ?? {}, ...parts.doc } as unknown as Document;
}

describe("fullscreen", () => {
  it("uses the standard API where it exists", () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const webkitRequestFullscreen = vi.fn();
    const doc = fakeDocument({ root: { requestFullscreen, webkitRequestFullscreen } });

    expect(enterFullscreen(doc)).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(webkitRequestFullscreen).not.toHaveBeenCalled();
  });

  it("falls back to WebKit's prefixed API, as on an iPad before iPadOS 16.4", () => {
    const webkitRequestFullscreen = vi.fn();
    const root = { webkitRequestFullscreen };
    const webkitExitFullscreen = vi.fn();
    const doc = fakeDocument({ root, doc: { webkitFullscreenElement: root, webkitExitFullscreen } });

    expect(enterFullscreen(doc)).toBe(true);
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
    expect(fullscreenElement(doc)).toBe(root);

    leaveFullscreen(doc);
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });

  it("reports that there is nothing to ask where neither API exists, as on an iPhone", () => {
    const doc = fakeDocument({});
    expect(enterFullscreen(doc)).toBe(false);
    expect(fullscreenElement(doc)).toBeNull();
  });

  it("swallows a refused request, whether it rejects or throws", async () => {
    const rejecting = fakeDocument({ root: { requestFullscreen: () => Promise.reject(new Error("denied")) } });
    expect(enterFullscreen(rejecting)).toBe(true);
    // Give the rejection a turn to surface as an unhandled one if it were going to.
    await Promise.resolve();

    const throwing = fakeDocument({ root: { requestFullscreen: () => { throw new Error("denied"); } } });
    expect(() => enterFullscreen(throwing)).not.toThrow();
    expect(enterFullscreen(throwing)).toBe(false);
  });

  it("does not try to leave fullscreen when the page is not in it", () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    leaveFullscreen(fakeDocument({ doc: { fullscreenElement: null, exitFullscreen } }));
    expect(exitFullscreen).not.toHaveBeenCalled();
  });
});
