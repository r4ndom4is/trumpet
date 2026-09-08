/* Desktop arrival is presentation, not gameplay. Activation always requires a click/key. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const root = document.documentElement, cabinet = document.querySelector(".cabinet");
  const arrival = $("arrival"), enter = $("enter-cabinet"), scene = $("arrival-scene");
  const previewMotion = $("preview-arrival-motion");
  const desktop = matchMedia("(min-width: 1100px) and (min-height: 600px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = matchMedia("(hover: hover) and (pointer: fine)");
  const requested = new URLSearchParams(location.search).get("entry");
  const preferenceKey = "trumpet-flight-cabinet-entered";
  const assetRoot = "./assets/cabinet/v2/";
  let state = "play", generation = 0, entered = false, currentMode;
  let frames = [], frameRequest = 0, dissolve;
  let framesReady = Promise.resolve();
  let motionOptIn = false, powerAnimations = [];
  try { entered = sessionStorage.getItem(preferenceKey) === "true"; }
  catch (error) { console.warn("Cabinet arrival preference is unavailable:", error); }

  function rememberEntry() {
    entered = true;
    try { sessionStorage.setItem(preferenceKey, "true"); }
    catch (error) { console.warn("Cabinet arrival preference could not be saved:", error); }
  }
  function finish(focus = true) {
    generation++;
    cancelAnimationFrame(frameRequest);
    dissolve?.cancel();
    state = root.dataset.cabinetView = "play";
    cabinet.dataset.power = "on";
    for (const animation of powerAnimations) animation.cancel();
    powerAnimations = [];
    arrival.hidden = true;
    $("arrival-motion").hidden = true;
    cabinet.inert = false;
    rememberEntry();
    if (focus) $("screen").focus({ preventScroll: true });
    document.dispatchEvent(new Event("cabinetready"));
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.decode().then(() => resolve(image), reject);
      image.onerror = () => reject(new Error("Unable to load cabinet arrival asset: " + file));
      image.src = assetRoot + file;
    });
  }
  function cue() {
    previewMotion.hidden = !reduced.matches;
    $("arrival-cue").textContent = reduced.matches
      ? "Reduced motion is on. Enter without animation, or preview the full power-on sequence."
      : pointer.matches ? "Click the cabinet to wake it" : "Tap the cabinet to wake it";
  }
  async function prepareMotion(mode, token) {
    const sequence = window.TRUMPET_CABINET.approach?.frames?.[mode] ?? [];
    if (!sequence.length) return;
    scene.dataset.motion = "loading";
    try {
      const loaded = await Promise.all(sequence.map(frame => loadImage(frame.file)));
      if (token === generation && state === "intro") {
        frames = loaded;
        scene.dataset.motion = "ready";
      }
    } catch (error) {
      if (token !== generation) return;
      scene.dataset.motion = "unavailable";
      console.warn("Camera sequence unavailable; using a direct dissolve:", error);
    }
  }
  function powerOn() {
    if (state !== "handoff") return;
    state = root.dataset.cabinetView = "powering";
    cabinet.dataset.power = "warming";
    scene.hidden = true;
    previewMotion.hidden = true;
    $("arrival-cue").textContent = "Powering on...";
    dissolve?.cancel();
    dissolve = null;
    const duration = 1000;
    const marqueeLight = cabinet.querySelector(".marquee-light").animate([
      { opacity: 0 }, { opacity: 1 }
    ], { duration: 650, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "forwards" });
    const screenGlow = cabinet.querySelector(".screen-power-glow").animate([
      { opacity: 0, transform: "scaleX(.18)", offset: 0 },
      { opacity: .5, transform: "scaleX(.4)", offset: .22 },
      { opacity: .08, transform: "scaleX(1)", offset: .38 },
      { opacity: 0, transform: "scaleX(1)", offset: .46 },
      { opacity: 0, transform: "scaleX(1)", offset: 1 }
    ], { duration, fill: "forwards" });
    const screenReveal = cabinet.querySelector(".screen-content").animate([
      { clipPath: "inset(50% 0)", filter: "brightness(.45)", offset: 0 },
      { clipPath: "inset(50% 0)", filter: "brightness(.55)", offset: .22, easing: "cubic-bezier(.16, 1, .3, 1)" },
      { clipPath: "inset(0% 0)", filter: "brightness(.9)", offset: .82 },
      { clipPath: "inset(0% 0)", filter: "brightness(1)", offset: 1 }
    ], { duration, fill: "forwards" });
    powerAnimations = [marqueeLight, screenGlow, screenReveal];
    screenReveal.onfinish = () => { if (state === "powering") finish(); };
  }
  function handoff() {
    if (state !== "waking") return;
    state = root.dataset.cabinetView = "handoff";
    if (reduced.matches && !motionOptIn) { finish(); return; }
    dissolve = arrival.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" });
    dissolve.onfinish = powerOn;
  }
  async function wake(forceMotion = false) {
    if (state !== "intro" || enter.disabled) return;
    enter.disabled = true;
    previewMotion.disabled = true;
    motionOptIn = forceMotion;
    const token = generation;
    if (reduced.matches && !forceMotion) { finish(); return; }
    if (forceMotion && !frames.length && scene.dataset.motion !== "loading") {
      framesReady = prepareMotion(currentMode, token);
    }
    if (scene.dataset.motion === "loading") {
      $("arrival-cue").textContent = "Loading the camera movement...";
      let timeout;
      try {
        await Promise.race([framesReady, new Promise(resolve => { timeout = setTimeout(resolve, 5000); })]);
      } finally {
        clearTimeout(timeout);
      }
      if (token !== generation || state !== "intro") return;
      if (scene.dataset.motion === "loading") console.warn("Camera sequence timed out; using a direct dissolve.");
    }
    if ((reduced.matches && !forceMotion) || document.hidden) { finish(); return; }
    state = root.dataset.cabinetView = "waking";
    $("arrival-cue").textContent = "Opening the arcade...";
    if (!frames.length) {
      $("announcement").textContent = "The camera movement could not load. You can play the game directly.";
      handoff();
      return;
    }
    const motion = $("arrival-motion");
    motion.src = frames[0].src;
    motion.hidden = false;
    const started = performance.now(), duration = window.TRUMPET_CABINET.approach.durationMs;
    let lastIndex = -1;
    function tick(now) {
      if (state !== "waking") return;
      const progress = Math.min(1, (now - started) / duration);
      const index = Math.min(frames.length - 1, Math.floor(progress * frames.length));
      if (index !== lastIndex) { motion.src = frames[index].src; lastIndex = index; }
      if (progress === 1) handoff();
      else frameRequest = requestAnimationFrame(tick);
    }
    frameRequest = requestAnimationFrame(tick);
  }
  async function show() {
    const token = ++generation;
    currentMode = root.dataset.theme === "dark" ? "dark" : "light";
    const mode = currentMode;
    state = root.dataset.cabinetView = "intro";
    cabinet.dataset.power = "off";
    cabinet.inert = true;
    scene.hidden = false;
    arrival.hidden = false;
    enter.disabled = true;
    previewMotion.disabled = false;
    previewMotion.hidden = true;
    frames = [];
    framesReady = Promise.resolve();
    scene.dataset.motion = "unavailable";
    scene.classList.remove("is-loaded");
    $("arrival-cue").textContent = "Preparing the cabinet...";
    try {
      const [image, shadow] = await Promise.all([
        loadImage("intro-" + mode + ".webp"), loadImage("intro-shadow-" + mode + ".webp")
      ]);
      if (token !== generation || state !== "intro") return;
      $("arrival-cabinet").src = image.src;
      $("arrival-shadow").src = shadow.src;
      scene.style.setProperty("--arrival-ratio", image.width + " / " + image.height);
      scene.classList.add("is-loaded");
      enter.disabled = false;
      cue();
    } catch (error) {
      if (token !== generation) return;
      console.warn("Cabinet introduction unavailable:", error);
      finish(false);
      $("announcement").textContent = "The cabinet introduction could not load. You can play the game directly.";
      return;
    }
    if (!reduced.matches) framesReady = prepareMotion(mode, token);
  }
  enter.addEventListener("click", () => wake());
  previewMotion.addEventListener("click", () => wake(true));
  $("skip-arrival").addEventListener("click", () => finish());
  pointer.addEventListener("change", () => { if (state === "intro" && !enter.disabled) cue(); });
  desktop.addEventListener("change", () => { if (!desktop.matches && state !== "play") finish(false); });
  reduced.addEventListener("change", () => {
    if (reduced.matches && (["waking", "handoff", "powering"].includes(state) || (state === "intro" && enter.disabled))) finish();
    else if (state === "intro" && !enter.disabled) {
      cue();
      if (!reduced.matches && !frames.length && scene.dataset.motion !== "loading") {
        framesReady = prepareMotion(currentMode, generation);
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && ["waking", "handoff", "powering"].includes(state)) finish(false);
  });
  new MutationObserver(() => {
    if (state === "intro" && root.dataset.theme !== currentMode) show();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (desktop.matches && requested !== "direct" && document.body.dataset.cabinetEntry !== "direct" &&
      (!entered || requested === "room")) show();
  else {
    root.dataset.cabinetView = "play";
    cabinet.dataset.power = "on";
  }
})();
