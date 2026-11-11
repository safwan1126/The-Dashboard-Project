// A thin wrapper over the Fullscreen API that also speaks WebKit's prefixed
// dialect. Safari only gained the standard names in 16.4; iPads on anything
// older have webkitRequestFullscreen and friends and nothing else. iPhones have
// neither for anything but video, which is why callers must treat real
// fullscreen as a bonus and never as a given.

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

// Both dialects announce a change; listen for each so neither is missed.
export const FULLSCREEN_EVENTS = ["fullscreenchange", "webkitfullscreenchange"] as const;

// Some implementations return a promise that rejects when the request is
// refused, others return nothing and throw. Neither should surface.
function settle(result: Promise<void> | void) {
  if (result && typeof result.catch === "function") result.catch(() => {});
}

export function fullscreenElement(doc: Document = document): Element | null {
  const d = doc as FullscreenDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

// Ask for the whole page to go fullscreen. Returns whether there was an API to
// ask; the request itself can still be refused.
export function enterFullscreen(doc: Document = document): boolean {
  const el = doc.documentElement as FullscreenElement;
  try {
    if (typeof el.requestFullscreen === "function") {
      settle(el.requestFullscreen());
      return true;
    }
    if (typeof el.webkitRequestFullscreen === "function") {
      settle(el.webkitRequestFullscreen());
      return true;
    }
  } catch {
    // Refused synchronously.
  }
  return false;
}

export function leaveFullscreen(doc: Document = document): void {
  if (!fullscreenElement(doc)) return;
  const d = doc as FullscreenDocument;
  try {
    if (typeof d.exitFullscreen === "function") settle(d.exitFullscreen());
    else if (typeof d.webkitExitFullscreen === "function") settle(d.webkitExitFullscreen());
  } catch {
    // Already out.
  }
}
