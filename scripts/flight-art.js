/* Production artwork is local, explicitly precached, and never depends on studies. */
(() => {
  "use strict";
  const files = ["rider.png", ...["day", "night"].flatMap(theme =>
    ["far", "mid", "near"].map(layer => `palace-${layer}-${theme}.png`))];
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error(`Artwork loading timed out: ${file}`)), 15000);
      image.onload = () => {
        clearTimeout(timer);
        if (!image.naturalWidth || !image.naturalHeight) reject(new Error(`Empty artwork: ${file}`));
        else resolve([file.slice(0, -4), image]);
      };
      image.onerror = () => { clearTimeout(timer); reject(new Error(`Unable to load artwork: ${file}`)); };
      image.src = `./assets/flight/${file}`;
    });
  }
  window.TRUMPET_FLIGHT_ART = Object.freeze({
    files,
    async load() {
      const images = Object.fromEntries(await Promise.all(files.map(loadImage)));
      return {
        rider: window.TRUMPET_PIXEL_RIDER.createRenderer(images),
        scenery: window.TRUMPET_PIXEL_SCENERY.createRenderer(images)
      };
    }
  });
})();
