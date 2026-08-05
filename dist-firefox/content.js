(function() {
  "use strict";
  const PAGE_SOURCE = "bct-page";
  const RELAY_SOURCE = "bct-relay";
  const PORT_NAME = "bct-tab";
  function isPageEnvelope(data) {
    return typeof data === "object" && data !== null && data.source === PAGE_SOURCE;
  }
  const SCRIPT_ID = "bct-injected-script";
  let port = null;
  const pending = [];
  function connect() {
    if (port) {
      return port;
    }
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      return null;
    }
    port.onDisconnect.addListener(() => {
      port = null;
    });
    port.onMessage.addListener((message) => {
      const envelope = { source: RELAY_SOURCE, message };
      window.postMessage(envelope, window.location.origin);
    });
    return port;
  }
  function forward(message) {
    const p = connect();
    if (!p) {
      return;
    }
    try {
      p.postMessage(message);
    } catch {
      port = null;
      pending.push(message);
      flushPending();
    }
  }
  function flushPending() {
    while (pending.length > 0) {
      const p = connect();
      if (!p) {
        return;
      }
      const message = pending.shift();
      if (!message) {
        return;
      }
      try {
        p.postMessage(message);
      } catch {
        port = null;
        pending.unshift(message);
        return;
      }
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || !isPageEnvelope(event.data)) {
      return;
    }
    forward(event.data.message);
  });
  function injectPageScript() {
    document.getElementById(SCRIPT_ID)?.remove();
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).appendChild(script);
  }
  connect();
  injectPageScript();
})();
