import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

// Local-only comparison: production HTML and stored scores are never changed.
export function resultPreview(file, content) {
  if (file !== "index.html") return content;
  let html = content.toString();
  const capture = html.slice(html.indexOf("    // Render the collision step"), html.indexOf('    state = "over"; deadAt'));
  if (!capture || !/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/.test(html)) {
    throw new Error("Game hooks for the result comparison are missing.");
  }
  html = html.replace(capture, `${capture}    captureResultScene();\n`);
  html = html.replace("</head>", `<style>
    .result-options { display: flex; flex: none; justify-content: center; gap: 6px; flex-wrap: wrap; }
    .result-options label { display: flex; align-items: center; gap: 6px; font: 12px sans-serif; color: var(--cp-text); }
    .result-options select { min-height: 44px; min-width: 0; padding: 6px; background: var(--cp-bg-elevated);
      color: var(--cp-text); border: 1px solid var(--cp-border-strong); border-radius: 3px; font: 12px sans-serif; }
    .result-options select:focus-visible { outline: 2px solid var(--cp-accent); outline-offset: 2px; }
    #result-zoom-scene { display: none; position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
    :root:is([data-result-option="zoom"], [data-result-option="zoom-dark"])
      .screen-content:has(.overlay[data-state="result"]:not([hidden])) #result-zoom-scene { display: block; }
    :root:is([data-result-option="zoom"], [data-result-option="zoom-dark"]) .overlay[data-state="result"] {
      background: linear-gradient(90deg, rgb(0 0 0 / .12) 0%, rgb(0 0 0 / .18) 36%, rgb(0 0 0 / .70) 62%, rgb(0 0 0 / .76) 100%);
    }
    :root[data-result-option="zoom-dark"] .overlay[data-state="result"] {
      background: linear-gradient(90deg, rgb(0 0 0 / .52) 0%, rgb(0 0 0 / .56) 36%, rgb(0 0 0 / .70) 62%, rgb(0 0 0 / .76) 100%);
    }
    :root:is([data-result-option="zoom"], [data-result-option="zoom-dark"]) .crashed .run-summary {
      padding-left: 52%; text-align: center; gap: 10px;
    }
    :root:is([data-result-option="zoom"], [data-result-option="zoom-dark"]) .crashed #title {
      font-size: clamp(12px, 4cqw, 19px); min-height: 2.4em; display: flex; align-items: end;
    }
    :root:is([data-result-option="zoom"], [data-result-option="zoom-dark"]) .crashed #run-score {
      font-size: clamp(40px, 19cqw, 80px);
    }
    :root:is([data-result-option="zoom"], [data-result-option="zoom-dark"]) .crashed #run-best {
      font-size: clamp(9px, 2.7cqw, 12px); min-height: 2.8em;
    }
    #result-reaction { display: none; width: min(190px, 52cqw); height: auto; max-height: 27cqh;
      object-fit: contain; image-rendering: pixelated; flex-shrink: 1; min-height: 0; }
    :root:is([data-result-option="portrait"], [data-result-option="both"]) .crashed #result-reaction { display: block; }
    :root:is([data-result-option="world"], [data-result-option="both"]) .overlay[data-state="result"] {
      background: rgb(0 0 0 / .64);
    }
    :root:is([data-result-option="world"], [data-result-option="both"]) .crashed .run-summary {
      text-shadow: 0 2px 3px rgb(0 0 0 / .7);
    }
    :root:is([data-result-option="world"], [data-result-option="both"]) .crashed .run-ranking {
      background: rgb(0 0 0 / .35);
    }
    @container (max-height: 360px) {
      :root:is([data-result-option="portrait"], [data-result-option="both"]) .crashed .run-summary {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-template-rows: 1fr auto auto 1fr; gap: 4px 10px;
      }
      .crashed #result-reaction { grid-column: 1; grid-row: 1 / -1; width: 100%; max-height: 32cqh; }
      :root:is([data-result-option="portrait"], [data-result-option="both"]) .crashed #title { grid-column: 2; grid-row: 2; font-size: 13px; }
      :root:is([data-result-option="portrait"], [data-result-option="both"]) .crashed #run-score { grid-column: 2; grid-row: 3; }
      :root:is([data-result-option="portrait"], [data-result-option="both"]) .crashed #run-best { grid-column: 2; grid-row: 4; align-self: start; font-size: 10px; }
    }
  </style></head>`);
  html = html.replace('<div class="run-summary">', `<div class="run-summary">
    <canvas id="result-reaction" width="280" height="208" role="img" aria-label="The collision close-up with a surprised expression"></canvas>`);
  html = html.replace('<div class="overlay" id="overlay"', '<canvas id="result-zoom-scene" width="420" height="512" aria-hidden="true"></canvas><div class="overlay" id="overlay"');
  html = html.replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/, `
  const impactScene = document.createElement("canvas");
  impactScene.width = W; impactScene.height = H;
  const impactSceneCtx = impactScene.getContext("2d");
  const zoomScene = $("result-zoom-scene");
  zoomScene.width = W; zoomScene.height = H;
  function captureResultScene() {
    impactSceneCtx.clearRect(0, 0, W, H);
    impactSceneCtx.drawImage(canvas, 0, 0);
    impactSceneCtx.save();
    impactSceneCtx.translate(Math.round(X), Math.round(bird.y));
    impactSceneCtx.rotate(riderTilt()); impactSceneCtx.scale(RIDER_SCALE, RIDER_SCALE);
    drawImpactFace(impactSceneCtx); impactSceneCtx.restore();
    const zoom = 3.25, width = W / zoom, height = H / zoom;
    const left = Math.max(0, Math.min(W - width, X - width * .27));
    const top = Math.max(0, Math.min(H - height, bird.y - height * .43));
    const target = zoomScene.getContext("2d");
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, W, H);
    target.drawImage(impactScene, left, top, width, height, 0, 0, W, H);
  }
  const comparison = document.createElement("nav");
  comparison.className = "result-options";
  comparison.setAttribute("aria-label", "Local result-screen comparison");
  document.querySelector(".shell > main").before(comparison);
  const variants = [["portrait", "A / Funny image"], ["world", "B / Faded game"], ["both", "C / Both"],
    ["zoom", "D / Zoomed crash"], ["zoom-dark", "E / Darkened crash"]];
  const variantLabel = document.createElement("label");
  variantLabel.textContent = "Version";
  const variantPicker = document.createElement("select");
  variantPicker.id = "result-variant";
  variantLabel.append(variantPicker); comparison.append(variantLabel);
  function selectResultOption(value) {
    document.documentElement.dataset.resultOption = value;
    variantPicker.value = value;
    const url = new URL(location.href); url.searchParams.set("result", value); history.replaceState(null, "", url);
    window.dispatchEvent(new Event("resize"));
  }
  for (const [value, label] of variants) {
    const option = document.createElement("option");
    option.value = value; option.textContent = label;
    variantPicker.append(option);
  }
  variantPicker.addEventListener("change", () => selectResultOption(variantPicker.value));
  const requested = new URL(location.href).searchParams.get("result");
  selectResultOption(variants.some(([value]) => value === requested) ? requested : "world");
  function copyReaction() {
    const target = $("result-reaction").getContext("2d");
    target.clearRect(0, 0, 280, 208);
    target.drawImage($("crash-closeup"), 0, 0);
  }
  document.addEventListener("flightretryready", copyReaction);
  function sampleCrash(position) {
    const rememberedBest = best;
    state = "playing"; score = 8; best = 12; death = null;
    bird.y = position === "sky" ? 32 : position === "middle" ? 250 : 440; bird.vy = 0;
    ${capture}
    captureResultScene();
    state = "over"; deadAt = performance.now() - 500;
    $("pause").disabled = true; overlay(); copyReaction(); notifyState(); draw();
    best = rememberedBest;
    $("announcement").textContent = "Sample result. Eight points. No scores have been saved.";
  }
  if (new URL(location.href).searchParams.get("sample") === "1") {
    const sceneLabel = document.createElement("label");
    sceneLabel.textContent = "Crash";
    const scenePicker = document.createElement("select");
    scenePicker.id = "result-sample";
    for (const [value, label] of [["middle", "Midair"], ["sky", "Sky"], ["ground", "Ground"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label;
      scenePicker.append(option);
    }
    sceneLabel.append(scenePicker); comparison.append(sceneLabel);
    const requestedScene = new URL(location.href).searchParams.get("crash");
    scenePicker.value = ["middle", "sky", "ground"].includes(requestedScene) ? requestedScene : "ground";
    scenePicker.addEventListener("change", () => {
      const url = new URL(location.href); url.searchParams.set("crash", scenePicker.value); history.replaceState(null, "", url);
      sampleCrash(scenePicker.value);
    });
    document.addEventListener("flightstate", () => { scenePicker.disabled = state === "playing" || state === "paused"; });
    sampleCrash(scenePicker.value);
  }
  requestAnimationFrame(frame);
})();`);
  return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4185);
  serve({ transform: resultPreview }).listen(port, "127.0.0.1", () =>
    console.log(`Result comparison: http://localhost:${port}/trumpet/?entry=direct&sample=1&result=world`));
}
