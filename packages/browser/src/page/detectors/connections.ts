export function wrapWebSocket(
  Native: typeof WebSocket,
  onFailure: (httpUrl: string) => void,
): typeof WebSocket {
  return class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      let opened = false;
      this.addEventListener("open", () => {
        opened = true;
      });
      this.addEventListener("close", (event) => {
        if (event.code !== 1006 || opened) return;
        const httpUrl = new URL(this.url);
        if (httpUrl.protocol === "ws:") httpUrl.protocol = "http:";
        if (httpUrl.protocol === "wss:") httpUrl.protocol = "https:";
        onFailure(httpUrl.href);
      });
    }
  };
}

export function wrapEventSource(
  Native: typeof EventSource,
  onFailure: (url: string) => void,
): typeof EventSource {
  return class extends Native {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super(url, eventSourceInitDict);
      let reported = false;
      this.addEventListener("error", () => {
        if (this.readyState !== Native.CLOSED || reported) return;
        reported = true;
        onFailure(this.url);
      });
    }
  };
}
