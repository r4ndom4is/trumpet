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
  html = html.replace("</head>", `<style>
    .result-options { display: flex; flex: none; justify-content: center; gap: 6px; flex-wrap: wrap; }
    .result-options button { min-height: 44px; padding: 7px 12px; border: 1px solid var(--cp-border-strong);
      border-radius: 3px; background: var(--cp-bg-elevated); color: var(--cp-text); font: 600 12px sans-serif; }
    .result-options button[aria-pressed="true"] { background: var(--cp-accent); color: var(--cp-on-accent, white); }
    .result-options button:focus-visible { outline: 2px solid var(--cp-accent); outline-offset: 2px; }
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
  html = html.replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/, `
  const comparison = document.createElement("nav");
  comparison.className = "result-options";
  comparison.setAttribute("aria-label", "Local result-screen comparison");
  document.querySelector(".shell > main").before(comparison);
  const variants = [["portrait", "A / Funny image"], ["world", "B / Faded game"], ["both", "C / Both"]];
  function selectResultOption(value) {
    document.documentElement.dataset.resultOption = value;
    comparison.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.option === value)));
    const url = new URL(location.href); url.searchParams.set("result", value); history.replaceState(null, "", url);
    window.dispatchEvent(new Event("resize"));
  }
  for (const [value, label] of variants) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.dataset.option = value;
    button.addEventListener("click", () => selectResultOption(value));
    comparison.append(button);
  }
  const requested = new URL(location.href).searchParams.get("result");
  selectResultOption(variants.some(([value]) => value === requested) ? requested : "world");
  function copyReaction() {
    const target = $("result-reaction").getContext("2d");
    target.clearRect(0, 0, 280, 208);
    target.drawImage($("crash-closeup"), 0, 0);
  }
  document.addEventListener("flightretryready", copyReaction);
  if (new URL(location.href).searchParams.get("sample") === "1") {
    const rememberedBest = best;
    state = "playing"; score = 8; best = 12; bird.y = 440; bird.vy = 0;
    ${capture}
    state = "over"; deadAt = performance.now() - 500;
    $("pause").disabled = true; overlay(); copyReaction(); notifyState(); draw();
    best = rememberedBest;
    $("announcement").textContent = "Sample result. Eight points. No scores have been saved.";
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
