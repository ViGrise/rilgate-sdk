export interface ResourceFailure {
  url: string;
  kind: "image" | "media" | "stylesheet" | "script";
  /** Loads the resource again after verification. */
  reload?: () => void;
}

export function monitorResources(
  win: Window,
  onFailure: (failure: ResourceFailure) => void,
): () => void {
  const report = (failure: ResourceFailure) => {
    if (!failure.url) return;
    try {
      if (new URL(failure.url, win.location.href).origin === win.location.origin)
        onFailure(failure);
    } catch {}
  };
  const onError = (event: Event) => {
    const element = event.target;
    if (element instanceof HTMLImageElement) {
      const url = element.currentSrc || element.src;
      report({
        url,
        kind: "image",
        reload: () => {
          element.src = url;
        },
      });
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      report({
        url: element.currentSrc || element.src,
        kind: "media",
        reload: () => element.load(),
      });
    } else if (
      element instanceof HTMLSourceElement &&
      element.parentElement instanceof HTMLMediaElement
    ) {
      const parent = element.parentElement;
      report({ url: element.src, kind: "media", reload: () => parent.load() });
    } else if (element instanceof HTMLLinkElement) {
      if (element.relList.contains("stylesheet")) {
        report({
          url: element.href,
          kind: "stylesheet",
          reload: () => {
            const clone = element.cloneNode(true) as HTMLLinkElement;
            clone.addEventListener("load", () => element.remove(), { once: true });
            element.after(clone);
          },
        });
      } else if (element.relList.contains("modulepreload") || element.relList.contains("preload")) {
        report({ url: element.href, kind: "script" });
      }
    } else if (element instanceof HTMLScriptElement) {
      report({ url: element.src, kind: "script" });
    } else if (
      element === win &&
      event instanceof ErrorEvent &&
      event.filename &&
      event.filename !== win.location.href &&
      event.error instanceof SyntaxError
    ) {
      report({ url: event.filename, kind: "script" });
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (
      !(event.reason instanceof Error) ||
      !/dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
        event.reason.message,
      )
    )
      return;
    const url = event.reason.message.match(/https?:\/\/\S+/)?.[0]?.replace(/[)'".]+$/, "");
    if (url) report({ url, kind: "script" });
  };
  win.addEventListener("error", onError, true);
  win.addEventListener("unhandledrejection", onRejection, true);
  return () => {
    win.removeEventListener("error", onError, true);
    win.removeEventListener("unhandledrejection", onRejection, true);
  };
}
