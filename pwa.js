(() => {
  "use strict";
  const install = document.getElementById("install");
  const help = document.getElementById("install-help");
  const update = document.getElementById("update");
  const status = document.getElementById("app-status");
  const standalone = matchMedia("(display-mode: standalone)");
  let deferredPrompt = null;
  let registration = null;
  let gameState = "ready";
  let offlineReady = false;

  function installedUI() {
    install.hidden = standalone.matches || navigator.standalone === true;
  }
  installedUI();
  standalone.addEventListener("change", installedUI);
  function renderStatus() {
    const hasUpdate = Boolean(registration?.waiting && registration?.active);
    update.hidden = !hasUpdate;
    if (hasUpdate) {
      status.textContent = "Update ready. Finish your flight, then close all game windows and reopen to update.";
    } else if (offlineReady) {
      status.textContent = navigator.onLine ? "Ready for offline play." : "Offline. Ready to fly.";
    }
  }
  window.addEventListener("online", renderStatus);
  window.addEventListener("offline", renderStatus);
  document.addEventListener("flightstate", event => {
    gameState = event.detail;
    update.disabled = gameState === "playing" || gameState === "paused";
  });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    install.textContent = "Install game";
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    install.hidden = true;
    help.hidden = true;
    status.textContent = "Installation accepted. Ready for your next flight.";
  });
  install.addEventListener("click", async () => {
    help.hidden = !help.hidden;
    install.setAttribute("aria-expanded", String(!help.hidden));
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome !== "accepted") {
        status.textContent = "Installation dismissed. You can keep playing in this browser.";
      }
    } catch (error) {
      status.textContent = "The install prompt could not open. Use your browser's install menu instead.";
      console.warn("Install prompt unavailable:", error);
    }
  });
  update.addEventListener("click", () => {
    if (gameState === "playing" || gameState === "paused") return;
    // No forced activation: even a second tab's active flight must survive.
    status.textContent = "To apply the update, close every Trumpet Flight tab or app window, then open the game again. Your saved best stays.";
  });

  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    status.textContent = "Offline play needs a supported browser on HTTPS or localhost. You can still play this page.";
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    offlineReady = true;
    renderStatus();
    // Never reload here: first installation or another window can change the controller mid-flight.
  });
  (async () => {
    try {
      registration = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
      const watch = worker => worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "activated") {
          renderStatus();
        } else if (worker.state === "redundant") {
          status.textContent = offlineReady
            ? "The update could not be saved. Your existing offline game is still available."
            : "Offline setup did not finish. Reconnect and reload to retry.";
        }
      });
      registration.addEventListener("updatefound", () => watch(registration.installing));
      if (registration.installing) watch(registration.installing);
      renderStatus();
      await navigator.serviceWorker.ready;
      offlineReady = true;
      renderStatus();
    } catch (error) {
      status.textContent = "Offline setup is unavailable. Stay connected to play, and reload to retry.";
      console.warn("Offline setup failed:", error);
    }
  })();
})();
