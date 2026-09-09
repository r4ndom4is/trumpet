/* Selected moving rider, extracted from the approved tuning renderer. */
(() => {
  "use strict";
  const LIGHT_DIRECTION = 315;
  const shadowOffset = (direction, distance) => ({
    x: Math.round(-Math.cos(direction * Math.PI / 180) * distance * 2),
    y: Math.round(-Math.sin(direction * Math.PI / 180) * distance * 2)
  });
  const surface = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const rgb = hex => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Use six-digit hex colors");
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  };

  function createRenderer(images) {
    if (images.rider.naturalWidth !== 896 || images.rider.naturalHeight !== 1024) throw new Error("Invalid registered rider artwork");
    const full = surface(896, 1024), fullCtx = full.getContext("2d", { willReadFrequently: true });
    fullCtx.drawImage(images.rider, 0, 0);
    const original = fullCtx.getImageData(0, 0, 896, 1024);
    let left = 896, top = 1024, right = -1, bottom = -1;
    for (let p = 0; p < 896 * 1024; p++) {
      if (!original.data[p * 4 + 3]) continue;
      left = Math.min(left, p % 896); right = Math.max(right, p % 896);
      top = Math.min(top, Math.floor(p / 896)); bottom = Math.max(bottom, Math.floor(p / 896));
    }
    if (right < left) throw new Error("Empty rider overlay");
    const padding = 40, ox = left - padding, oy = top - padding;
    const w = right - left + 1 + padding * 2, h = bottom - top + 1 + padding * 2;
    const crop = surface(w, h), painter = crop.getContext("2d", { willReadFrequently: true });
    painter.drawImage(images.rider, -ox, -oy);
    const bottomProfile = [];
    for (let x = left; x <= right; x++) {
      for (let y = bottom; y >= top; y--) {
        if (!original.data[(y * 896 + x) * 4 + 3]) continue;
        bottomProfile.push({ x: (x - 216) / 2, y: (y + 1 - 420) / 2 });
        break;
      }
    }
    const shadow = surface(w, h), shadowCtx = shadow.getContext("2d");
    function drawShadow(ctx, px, py, color, opacity, direction, distance, blur, tilt = 0, anchorX = 0, anchorY = 0) {
      shadowCtx.clearRect(0, 0, w, h);
      shadowCtx.globalCompositeOperation = "source-over";
      shadowCtx.drawImage(crop, 0, 0);
      shadowCtx.globalCompositeOperation = "source-in";
      shadowCtx.fillStyle = color;
      shadowCtx.fillRect(0, 0, w, h);
      shadowCtx.globalCompositeOperation = "source-over";
      const offset = shadowOffset(direction, distance);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = blur ? `blur(${blur * 2}px)` : "none";
      ctx.translate(anchorX + offset.x, anchorY + offset.y);
      ctx.rotate(tilt);
      ctx.drawImage(shadow, px - anchorX, py - anchorY);
      ctx.restore();
    }
    return {
      bounds: { left, top, right, bottom },
      bottomAt(tilt) {
        const sin = Math.sin(tilt), cos = Math.cos(tilt);
        return Math.max(...bottomProfile.map(p => (p.x + (sin >= 0 ? .5 : 0)) * sin + p.y * cos));
      },
      // Logical game coordinates. Rotate the silhouette, not the world-space
      // light vector: the shadow must still trail down-left during a dive.
      drawMovingRider(ctx, { x = 108, y = 210, tilt = 0, color = "#2d3c51", strength = .65,
        shadowDistance = 3.5, shadowBlur = 1.5, enabled = true } = {}) {
        rgb(color);
        for (const [value, min, max] of [[x, -896, 896], [y, -1024, 1024], [tilt, -Math.PI, Math.PI],
          [strength, 0, 1], [shadowDistance, 0, 8], [shadowBlur, 0, 4]]) {
          if (!Number.isFinite(value) || value < min || value > max) throw new RangeError("Moving rider setting outside its range");
        }
        const ax = x * 2, ay = y * 2;
        ctx.save();
        ctx.scale(.5, .5);
        if (enabled && strength > 0) {
          drawShadow(ctx, ax + ox - 216, ay + oy - 420, color, strength, LIGHT_DIRECTION,
            shadowDistance, shadowBlur, tilt, ax, ay);
        }
        ctx.translate(ax, ay);
        ctx.rotate(tilt);
        ctx.drawImage(crop, ox - 216, oy - 420);
        ctx.restore();
      },
    };
  }
  window.TRUMPET_PIXEL_RIDER = Object.freeze({ createRenderer });
})();
