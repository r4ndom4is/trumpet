/* Trumpet Flight - approved six-environment artwork.
 *
 * Six ENV-16 concepts from the art-direction brief. Every ramp is the brief's exact
 * sixteen hexes in slot order; restrained scenery stays behind the unchanged
 * obstacle artwork. Embedded into index.html for atomic offline updates.
 */
(() => {
  "use strict";

  const SLOTS = ["SKY-HI", "SKY-LO", "SKY-GLOW", "HAZE", "FAR-1", "FAR-2", "MID-1", "MID-2",
    "OBST-LIT", "OBST-BASE", "OBST-SHADE", "OBST-EDGE", "TRIM", "GROUND", "GROUND-DETAIL", "INK"];

  const ramp = (...hex) => {
    if (hex.length !== 16) throw new Error("a ramp needs exactly 16 colours");
    const out = {};
    SLOTS.forEach((slot, i) => { out[slot] = hex[i]; });
    return out;
  };

  /* World geometry, matching the shipping canvas. */
  const W = 448, H = 512, FLOOR = 468;
  const LIP = 20;                 // default cap height
  const COLLIDE = 66;             // gap-facing cap width; every cap must fill this exactly
  const EDGE = 2;                 // OBST-EDGE thickness
  const SPACING = 232;            // preview obstacle cadence

  /* Shaft widths, 54-58 px. The cap still spans the full 66 px so the gap the rider
   * flies through is unchanged, but the body is slimmer, which is what makes the cap
   * read as a real architectural overhang instead of a flat slab on a flat post.
   *
   * Collision follows the drawing exactly: the cap is lethal across 66 px, the shaft
   * is lethal across its own width and no more. Narrowing the shaft therefore only
   * ever removes lethal area - see hitboxes(). */
  const SHAFT = {
    "obst-colonnade-66": 56,
    "obst-broken-drum-66": 56,
    "obst-elevator-pylon-66": 54,
    "obst-topiary-pillar-66": 56,
    "obst-rooftop-stack-66": 56,
    "obst-gantry-tower-66": 54
  };

  /* Cap heights, measured outward from the gap face. */
  const CAP_H = {
    "obst-colonnade-66": 20,
    "obst-broken-drum-66": 20,
    "obst-elevator-pylon-66": 18,
    "obst-topiary-pillar-66": 20,
    "obst-rooftop-stack-66": 22,
    "obst-gantry-tower-66": 16
  };

  /* Half the cap overhang: the margin decoration is allowed to occupy. */
  const wingOf = id => (COLLIDE - SHAFT[id]) >> 1;
  const DECOR_CLEAR = 24;         // decoration keeps this far back from either gap face

  /* Distant architecture moves slowly enough to read at phone resolution. */
  const RATES = { haze: 0.015, clouds: 0.025, far: 0.055, mid: 0.12, world: 1.0, fore: 1.7 };
  const LANDMARK = { x: 194, width: 224, hold: 8, speed: 12 };

  /* Sky structure: two dithered transitions replace the hard y=330 seam. */
  const SKY = { hiTo: 168, d1: 36, loTo: 292, d2: 36 };
  const HAZE_TOP = SKY.loTo + SKY.d2;   // 328

  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const wrap = (value, period) => ((value % period) + period) % period;

  /* ---------------------------------------------------------------- painter */

  function painter(ctx, P, reduced) {
    const g = {
      ctx, P, reduced,
      px(x, y, w, h, slot, alpha) {
        if (w <= 0 || h <= 0) return;
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        ctx.fillStyle = P[slot] || slot;
        ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        ctx.globalAlpha = 1;
      },
      /* 2 px ordered-dither band; the replacement for the hard seam. */
      dither(x0, y0, w, h, from, to) {
        g.px(x0, y0, w, h, from);
        const rows = Math.max(1, Math.floor(h / 2));
        const bayer = [[0, 2], [3, 1]];
        ctx.fillStyle = P[to] || to;
        for (let r = 0; r < rows; r++) {
          const density = (r + 0.5) / rows;
          for (let c = 0; c * 2 < w; c++) {
            if (density > (bayer[r & 1][c & 1] + 0.5) / 4) ctx.fillRect(x0 + c * 2, y0 + r * 2, 2, 2);
          }
        }
      },
      /* Decorative pixels. Drawn like any other, but recorded so the validator can
       * prove they sit outside every hitbox: outliers must never kill the rider. */
      marks: [],
      deco(x, y, w, h, slot, alpha) {
        if (w <= 0 || h <= 0) return;
        g.px(x, y, w, h, slot, alpha);
        g.marks.push({
          x: Math.round(x), y: Math.round(y),
          w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h))
        });
      },
      /* Repeat a unit across the scrolling band, wrapping cleanly. */
      repeat(offset, period, pad, fn) {
        const start = -wrap(offset, period) - period;
        for (let x = start; x < W + period + pad; x += period) fn(Math.round(x));
      }
    };
    return g;
  }

  /* --------------------------------------------------------------- obstacle */

  /* Shaft body. `x` is the left edge of the 66 px cap footprint; the body is centred
   * inside it at `sw` px, which is exactly the run the shaft hitbox covers. Bands are
   * [offset, width, slot, alpha]; a negative offset counts back from the right face. */
  function body(g, x, y, h, sw, bands) {
    if (h <= 0) return null;
    const o = x + ((COLLIDE - sw) >> 1);
    g.px(o, y, sw, h, "OBST-BASE");
    if (bands) for (const b of bands) g.px(o + (b[0] < 0 ? sw + b[0] : b[0]), y, b[1], h, b[2], b[3]);
    g.px(o, y, 1, h, "INK");
    g.px(o + sw - 1, y, 1, h, "INK");
    return o;
  }

  /* The contract: a fully opaque cap, exactly COLLIDE wide, overhanging the shaft on
   * both sides, with a 2 px OBST-EDGE on the gap-facing side. Day ramps make that edge
   * the darkest colour on the obstacle; night ramps make it the lightest, so it
   * rim-lights instead.
   *
   * `paint(band, inlay)` builds the profile in depth order, where depth 0 is the gap
   * face and depth grows outward. That keeps every concept's cap authored from the
   * surface the rider actually reads. */
  function cap(g, x, gapY, down, h, sw, paint) {
    const y0 = down ? gapY : gapY - h;
    g.px(x, y0, COLLIDE, h, "OBST-BASE");
    const rowY = (depth, th) => {
      const d = Math.max(0, Math.min(h, depth));
      const t = Math.max(0, Math.min(h - d, th));
      return t > 0 ? [down ? y0 + d : y0 + h - d - t, t] : null;
    };
    const band = (depth, th, slot, alpha) => {
      const r = rowY(depth, th);
      if (r) g.px(x, r[0], COLLIDE, r[1], slot, alpha);
    };
    const inlay = (depth, th, ix, iw, slot, alpha) => {
      const r = rowY(depth, th);
      if (r) g.px(x + ix, r[0], iw, r[1], slot, alpha);
    };
    if (paint) paint(band, inlay);
    band(0, EDGE, "OBST-EDGE");
    // Ink the overhang's outward face so the step down onto the shaft reads at 1x.
    const wing = (COLLIDE - sw) >> 1;
    const outer = down ? y0 + h - 1 : y0;
    g.px(x, outer, wing, 1, "INK");
    g.px(x + COLLIDE - wing, outer, wing, 1, "INK");
    g.px(x, y0, 1, h, "INK");
    g.px(x + COLLIDE - 1, y0, 1, h, "INK");
  }

  /* Decoration in the margin between the shaft face and the cap footprint. It is
   * painted, tagged, and excluded from collision, and it always leaves at least 1 px
   * of background inside the 66 px envelope - so the silhouette the rider avoids is
   * never as wide as the cap, and decoration can never be read as lethal body. */
  function outlier(g, x, y, w, h, side, sw, slot, alpha) {
    const wing = (COLLIDE - sw) >> 1;
    const ww = Math.max(1, Math.min(w, wing - 1));
    g.deco(side < 0 ? x + wing - ww : x + COLLIDE - wing, y, ww, h, slot, alpha);
  }

  /* Pick decoration rows inside a shaft run, kept clear of the gap face so nothing
   * decorative can be mistaken for the edge of the playable gap. */
  function decorRows(y0, h, gapAtEnd, n, dh, key) {
    const lo = y0 + (gapAtEnd ? 8 : DECOR_CLEAR);
    const hi = y0 + h - (gapAtEnd ? DECOR_CLEAR : 8) - dh;
    const rows = [];
    if (hi <= lo) return rows;
    for (let i = 0; i < n; i++) {
      rows.push({
        y: Math.round(lo + hash(key + i * 2.3) * (hi - lo)),
        side: hash(key + i * 5.1) > .5 ? 1 : -1
      });
    }
    return rows;
  }

  /* The lethal rectangles, in the order they are drawn. Collision follows the pixels:
   * 66 px across the cap, the shaft width across the shaft, and nothing else. */
  function hitboxes(obstacleId, x, top, gap, floorY) {
    const sw = SHAFT[obstacleId] || COLLIDE;
    const ch = CAP_H[obstacleId] || LIP;
    const o = x + ((COLLIDE - sw) >> 1);
    const out = [];
    const push = (bx, by, bw, bh, part) => { if (bw > 0 && bh > 0) out.push({ x: bx, y: by, w: bw, h: bh, part }); };
    push(o, 0, sw, top - ch, "ceiling-shaft");
    push(x, top - ch, COLLIDE, ch, "ceiling-cap");
    push(x, top + gap, COLLIDE, ch, "floor-cap");
    push(o, top + gap + ch, sw, floorY - top - gap - ch, "floor-shaft");
    return out;
  }

  /* Each concept's obstacle. `x` is the left edge of the 66 px cap footprint. */
  const OBSTACLES = {
    /* Fluted shaft under a square abacus over a cornice fillet. */
    "obst-colonnade-66": (g, x, top, gap, floorY) => {
      const sw = SHAFT["obst-colonnade-66"], ch = CAP_H["obst-colonnade-66"];
      const stone = (y0, h, key, gapAtEnd) => {
        const o = body(g, x, y0, h, sw, [[0, 9, "OBST-LIT"], [-10, 10, "OBST-SHADE"]]);
        if (o === null) return;
        for (let i = 0; i < 3; i++) g.px(o + 16 + i * 12, y0, 2, h, "OBST-SHADE", .55);
        // Corbels: 3 px consoles tucked under the overhang. Decorative, never lethal.
        for (const r of decorRows(y0, h, gapAtEnd, 2, 4, key)) {
          outlier(g, x, r.y, 3, 4, r.side, sw, "OBST-SHADE");
          outlier(g, x, r.y, 3, 1, r.side, sw, "OBST-LIT");
        }
      };
      const abacus = band => {
        band(2, 3, "TRIM");            // teal band on the gap face, per the readability note
        band(5, 1, "OBST-LIT");
        band(6, 5, "OBST-BASE");       // abacus slab
        band(11, 2, "OBST-SHADE");     // cornice fillet
        band(13, 3, "OBST-LIT");       // echinus
        band(16, 4, "OBST-BASE");      // necking
        band(19, 1, "OBST-SHADE");
      };
      stone(0, top - ch, x * .07, true);
      cap(g, x, top, false, ch, sw, abacus);
      stone(top + gap + ch, floorY - top - gap - ch, x * .07 + 40, false);
      cap(g, x, top + gap, true, ch, sw, abacus);
    },

    /* Stacked drums under a chamfered coping course. */
    "obst-broken-drum-66": (g, x, top, gap, floorY) => {
      const sw = SHAFT["obst-broken-drum-66"], ch = CAP_H["obst-broken-drum-66"];
      const drums = (y0, h, key, gapAtEnd) => {
        const o = body(g, x, y0, h, sw, [[0, 8, "OBST-LIT"], [-9, 9, "OBST-SHADE"]]);
        if (o === null) return;
        for (let y = y0 + 14; y < y0 + h; y += 14) {
          g.px(o + 1, y, sw - 2, 1, "OBST-SHADE");
          g.px(o + 1, y + 1, sw - 2, 1, "OBST-LIT", .35);
        }
        // Spalled course ends. Cut into the decorative margin, never into the shaft,
        // so no chip can ever open a hole in the lethal body.
        for (const r of decorRows(y0, h, gapAtEnd, 3, 5, key)) {
          const bh = 3 + Math.floor(hash(key + r.y * .13) * 3);
          outlier(g, x, r.y, 3, bh, r.side, sw, "OBST-BASE");
          outlier(g, x, r.y, 3, 1, r.side, sw, "OBST-SHADE");
        }
      };
      const coping = band => {
        band(2, 2, "OBST-LIT");        // chamfer
        band(4, 6, "OBST-BASE");       // coping slab
        band(10, 2, "OBST-SHADE");     // drip groove
        band(12, 4, "OBST-LIT");
        band(16, 4, "OBST-BASE");
        band(19, 1, "OBST-SHADE");
      };
      drums(0, top - ch, x * .07, true);
      cap(g, x, top, false, ch, sw, coping);
      drums(top + gap + ch, floorY - top - gap - ch, x * .07 + 40, false);
      cap(g, x, top + gap, true, ch, sw, coping);
    },

    /* Mirrored pylon under a machined collar with a bolt row. */
    "obst-elevator-pylon-66": (g, x, top, gap, floorY) => {
      const sw = SHAFT["obst-elevator-pylon-66"], ch = CAP_H["obst-elevator-pylon-66"];
      const mirror = (y0, h, key, gapAtEnd) => {
        // Specular stripe sits off-centre so it never reads as a gap.
        const o = body(g, x, y0, h, sw, [[0, 8, "OBST-SHADE"], [-10, 10, "OBST-SHADE"],
          [16, 6, "OBST-LIT"], [24, 2, "OBST-LIT", .45]]);
        if (o === null) return;
        // Cable guides: 3 px clips under the collar. Decorative, never lethal.
        for (const r of decorRows(y0, h, gapAtEnd, 3, 3, key)) {
          outlier(g, x, r.y, 3, 3, r.side, sw, "OBST-SHADE");
          outlier(g, x, r.y + 1, 3, 1, r.side, sw, "OBST-LIT");
        }
      };
      const collar = (band, inlay) => {
        band(2, 2, "OBST-LIT");        // machined lip
        band(4, 3, "OBST-SHADE");      // recess
        band(7, 5, "OBST-BASE");       // flange face
        for (let i = 0; i < 5; i++) inlay(8, 3, 9 + i * 12, 3, "OBST-SHADE");
        band(12, 3, "OBST-LIT");
        band(15, 3, "OBST-SHADE");
      };
      mirror(0, top - ch, x * .05, true);
      cap(g, x, top, false, ch, sw, collar);
      mirror(top + gap + ch, floorY - top - gap - ch, x * .05 + 40, false);
      cap(g, x, top + gap, true, ch, sw, collar);
    },

    /* Clipped yew under a crown at the ceiling and over a planter base at the floor. */
    "obst-topiary-pillar-66": (g, x, top, gap, floorY) => {
      const sw = SHAFT["obst-topiary-pillar-66"], ch = CAP_H["obst-topiary-pillar-66"];
      const yew = (y0, h, key, gapAtEnd) => {
        const o = body(g, x, y0, h, sw, [[0, 11, "OBST-LIT"], [-12, 12, "OBST-SHADE"]]);
        if (o === null) return;
        for (let i = 0; i < Math.floor(h / 3); i++) {
          g.px(o + 2 + Math.floor(hash(key + i) * (sw - 6)), y0 + i * 3 + 1, 2, 2, "OBST-SHADE", .5);
        }
        // Vines: 1 px meanders hugging the outer faces, with 1-3 px leaves. Kept inside
        // the shaft so the lethal body stays solid and the silhouette stays crisp.
        for (const side of [0, 1]) {
          const vx = side ? o + sw - 6 : o + 4;
          for (let y = y0 + 2; y < y0 + h - 3; y += 2) {
            const wob = Math.round(Math.sin((y + key * 9) * .11 + side * 2.1) * 2);
            g.px(vx + wob, y, 1, 2, "OBST-SHADE", .75);
            if (hash(key + y * .37 + side) > .88) {
              const lw = 1 + Math.floor(hash(key + y * .11 + side) * 3);
              const lx = side ? vx + wob + 1 : vx + wob - lw;
              g.px(Math.max(o + 1, Math.min(o + sw - 1 - lw, lx)), y, lw, 2, "OBST-LIT", .75);
            }
          }
        }
        // Leaf clumps that break the silhouette: 2-4 px, outer faces, tagged non-lethal.
        for (const r of decorRows(y0, h, gapAtEnd, 4, 4, key + 3)) {
          const lw = 2 + Math.floor(hash(key + r.y * .21) * 3);
          outlier(g, x, r.y, lw, 3, r.side, sw, "OBST-BASE");
          outlier(g, x, r.y, lw, 1, r.side, sw, "OBST-LIT");
        }
      };
      const crown = (band, inlay) => {
        band(2, 3, "OBST-SHADE");      // shadow under the clipped crown
        band(5, 7, "OBST-BASE");
        for (let i = 0; i < 8; i++) inlay(6, 4, 3 + i * 8, 4, hash(x + i) > .5 ? "OBST-LIT" : "OBST-SHADE", .55);
        band(12, 4, "OBST-LIT");
        band(16, 4, "OBST-BASE");
      };
      const planter = band => {
        band(2, 2, "TRIM");            // painted rim
        band(4, 5, "OBST-LIT");
        band(9, 5, "OBST-BASE");
        band(14, 2, "OBST-SHADE");
        band(16, 4, "OBST-BASE");
      };
      yew(0, top - ch, x * .11, true);
      cap(g, x, top, false, ch, sw, crown);
      yew(top + gap + ch, floorY - top - gap - ch, x * .11 + 70, false);
      cap(g, x, top + gap, true, ch, sw, planter);
    },

    /* Scaffolded stack under a flared vent hood with a louvred back. */
    "obst-rooftop-stack-66": (g, x, top, gap, floorY) => {
      const sw = SHAFT["obst-rooftop-stack-66"], ch = CAP_H["obst-rooftop-stack-66"];
      const stack = (y0, h, key, gapAtEnd) => {
        const o = body(g, x, y0, h, sw, [[8, 14, "OBST-LIT"], [-11, 11, "OBST-SHADE"]]);
        if (o === null) return;
        // Scaffold lattice on the outer faces only; it never touches the cap.
        for (let y = y0 + 6; y < y0 + h - 4; y += 10) {
          g.px(o + 1, y, 6, 2, "OBST-SHADE");
          g.px(o + sw - 7, y, 6, 2, "OBST-SHADE");
        }
        // Hood brackets and a conduit stub: 3 px, tagged non-lethal.
        for (const r of decorRows(y0, h, gapAtEnd, 3, 4, key)) {
          outlier(g, x, r.y, 3, 4, r.side, sw, "OBST-SHADE");
          outlier(g, x, r.y + 1, 3, 1, r.side, sw, "OBST-LIT");
        }
      };
      const hood = (band, inlay) => {
        band(2, 3, "OBST-SHADE");      // hood underside
        band(5, 3, "TRIM");            // painted band
        band(8, 6, "OBST-LIT");        // hood face
        band(14, 3, "OBST-BASE");
        band(17, 5, "OBST-SHADE");     // louvred back
        for (let i = 0; i < 4; i++) inlay(18, 3, 8 + i * 14, 7, "OBST-LIT", .5);
      };
      stack(0, top - ch, x * .09, true);
      cap(g, x, top, false, ch, sw, hood);
      stack(top + gap + ch, floorY - top - gap - ch, x * .09 + 50, false);
      cap(g, x, top + gap, true, ch, sw, hood);
    },

    /* Truss tower under a grated maintenance platform with a kick rail. */
    "obst-gantry-tower-66": (g, x, top, gap, floorY) => {
      const sw = SHAFT["obst-gantry-tower-66"], ch = CAP_H["obst-gantry-tower-66"];
      const tower = (y0, h, key, gapAtEnd) => {
        const o = body(g, x, y0, h, sw, [[6, 15, "OBST-LIT"], [-12, 12, "OBST-SHADE"]]);
        if (o === null) return;
        // Truss diagonals on the outer faces only.
        for (let y = y0; y < y0 + h - 6; y += 8) {
          for (let i = 0; i < 5; i++) {
            g.px(o + 1 + i, y + i, 2, 2, "OBST-SHADE", .8);
            g.px(o + sw - 3 - i, y + i, 2, 2, "OBST-SHADE", .8);
          }
        }
        // Cryo frost, kept well away from the cap.
        for (let i = 0; i < Math.floor(h / 9); i++) {
          g.px(o + sw - 12 + Math.floor(hash(key + i) * 8), y0 + 4 + i * 9, 1, 1, "OBST-LIT");
        }
        // Handrail stanchions: 3 px, tagged non-lethal.
        for (const r of decorRows(y0, h, gapAtEnd, 3, 4, key)) {
          outlier(g, x, r.y, 3, 4, r.side, sw, "OBST-SHADE");
          outlier(g, x, r.y, 3, 1, r.side, sw, "OBST-LIT");
        }
      };
      const platform = (band, inlay) => {
        band(2, 2, "OBST-SHADE");      // deck shadow
        band(4, 4, "OBST-LIT");        // deck plate
        for (let i = 0; i < 8; i++) inlay(5, 2, 4 + i * 8, 4, "OBST-SHADE", .7);
        band(8, 3, "OBST-BASE");
        band(11, 5, "OBST-SHADE");     // kick rail
        for (let i = 0; i < 6; i++) inlay(12, 2, 6 + i * 10, 2, "OBST-LIT", .8);
      };
      tower(0, top - ch, x * .05, true);
      cap(g, x, top, false, ch, sw, platform);
      tower(top + gap + ch, floorY - top - gap - ch, x * .05 + 55, false);
      cap(g, x, top + gap, true, ch, sw, platform);
    }
  };

  /* ------------------------------------------------------------ sky + haze */

  function sky(g, t) {
    g.px(0, 0, W, SKY.hiTo, "SKY-HI");
    g.dither(0, SKY.hiTo, W, SKY.d1, "SKY-HI", "SKY-LO");
    g.px(0, SKY.hiTo + SKY.d1, W, SKY.loTo - SKY.hiTo - SKY.d1, "SKY-LO");
    g.dither(0, SKY.loTo, W, SKY.d2, "SKY-LO", "HAZE");
    g.px(0, HAZE_TOP, W, FLOOR - HAZE_TOP, "HAZE");
  }

  function disc(g, cx, cy, r) {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
      if (half > 0) g.px(cx - half, cy + y, half * 2, 1, "SKY-GLOW");
    }
  }

  function clouds(g, off, rows) {
    g.repeat(off, 214, 90, x => {
      for (const [dx, dy, w, s] of rows) {
        g.px(x + dx + 12 * s, dy, 24 * s, 8 * s, "SKY-GLOW", .5);
        g.px(x + dx + 4 * s, dy + 8 * s, 44 * s, 8 * s, "SKY-GLOW", .5);
        g.px(x + dx, dy + 16 * s, 58 * s, 6 * s, "SKY-GLOW", .38);
      }
    });
  }

  /* A fascia/billboard mounted by each environment's architecture, never HUD text.
   * Only existing palette slots are used; the sign has no obstacle-edge treatment. */
  function scenicSign(g, text, x, y) {
    const width = 208, height = 28;
    g.px(x, y, width, height, "FAR-2");
    g.px(x + 2, y + 2, width - 4, height - 4, "MID-2");
    const ctx = g.ctx;
    ctx.save();
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = g.P["SKY-GLOW"];
    ctx.globalAlpha = .9;
    ctx.fillText(text, Math.round(x + width / 2), y + height / 2 + 1);
    ctx.restore();
    return { text, x: Math.round(x), y, width, height };
  }

  function pitchedRoof(g, x, y, width, rise) {
    for (let row = 0; row < rise; row += 2) {
      const inset = Math.round((1 - row / rise) * width / 2);
      g.px(x + inset, y + row, width - inset * 2, 2, "MID-1");
    }
    g.px(x - 4, y + rise, width + 8, 4, "MID-2");
  }

  function waterTank(g, x, roofY) {
    // Broad cylinder, lid and two braced legs, all visibly planted on a roof.
    g.px(x + 7, roofY - 18, 4, 18, "MID-2");
    g.px(x + 33, roofY - 18, 4, 18, "MID-2");
    g.px(x + 7, roofY - 10, 30, 3, "MID-1");
    g.px(x + 2, roofY - 49, 40, 32, "MID-1");
    g.px(x + 33, roofY - 49, 9, 32, "MID-2");
    g.px(x, roofY - 51, 44, 4, "MID-2");
    g.px(x + 6, roofY - 55, 32, 4, "MID-1");
    g.px(x + 2, roofY - 24, 40, 3, "MID-2");
  }

  /* ------------------------------------------------------------- concepts */

  const ENVS = [
    {
      id: "env-a-gilded-mile-16",
      name: "The Gilded Mile",
      levelName: "The Gilded Mile",
      level: 1,
      obstacleId: "obst-colonnade-66",
      obstacleName: "Colonnade",
      recommended: true,
      premise: "A resort boulevard at golden hour, so over-decorated that the lobby colonnade escaped the building and marched down the median.",
      obstacleNote: "A 56 px fluted shaft under a full 66 px cap: teal TRIM on the gap face, then an abacus slab and a cornice fillet. The 5 px overhang gives the capital a real step; 3 px corbels sit in that margin, tagged decorative and excluded from collision.",
      readability: "Greige stone is the nearest neighbour to the rider's warm skin, held apart by desaturation (S about 10% against the skin's 84%), a teal TRIM band on the gap lip, and an OBST-EDGE that never lets the rider overlap an unbounded beige field.",
      scores: { separation: "Good", charm: "High", clutter: "Low", themeRange: "Excellent" },
      nightLabel: "Night",
      ramps: {
        day: ramp("#cfe6f2", "#e8eef0", "#f6e8d6", "#dbe7ea", "#a9c2ce", "#8ba7b6", "#7c98a6", "#5f7d8d",
          "#e3ded6", "#c6c0b4", "#97907f", "#4a3f38", "#2f7d6b", "#8d9a94", "#6d7c76", "#241d1a"),
        night: ramp("#16202b", "#253442", "#cfd8e6", "#2c3d4b", "#33475a", "#405a70", "#2b3d4d", "#1e2c39",
          "#8d9aa6", "#6b7a88", "#4a5763", "#cbd7e2", "#46c2a6", "#202b34", "#33424e", "#0b1116")
      },
      glow: [352, 66, 22],
      clouds: [[0, 74, 0, 1], [96, 122, 0, .7]],
      far(g, off) {
        g.repeat(off, 244, 60, x => {
          for (let i = 0; i < 3; i++) {
            const h = 46 + i * 22, bx = x + i * 64;
            g.px(bx, 372 - h, 52, h, "FAR-1");
            g.px(bx + 8, 366 - h, 36, 6, "FAR-2");
            for (let y = 382 - h; y < 366; y += 22) g.px(bx + 6, y, 40, 2, "FAR-2");
          }
        });
      },
      mid(g, off, t) {
        // Palms sway 1 px; the obstacle never animates.
        g.repeat(off - 64, 254, 70, x => {
          const sway = g.reduced ? 0 : Math.round(Math.sin(t * 1.1 + x * .04));
          g.px(x + 30, 373, 5, FLOOR - 373, "MID-2");
          for (let i = 0; i < 4; i++) {
            const dx = i * 7;
            g.px(x + 30 - dx + sway, 368 + i * 3, 10, 4, "MID-1");
            g.px(x + 30 + dx + sway, 368 + i * 3, 10, 4, "MID-1");
          }
          g.px(x + 72, 438, 80, 30, "MID-1");
          g.px(x + 68, 432, 88, 6, "MID-2");
        });
      },
      landmark(g, x) {
        // Resort entrance: canopy, recessed doors and planted side wings.
        g.px(x, 396, 224, FLOOR - 396, "MID-1");
        g.px(x + 64, 402, 96, 66, "MID-2");
        for (let i = 0; i < 3; i++) g.px(x + 72 + i * 30, 408, 22, 50, "FAR-2");
        g.px(x - 4, 390, 232, 7, "MID-2");
        g.px(x + 8, 449, 40, 19, "MID-2");
        g.px(x + 176, 449, 40, 19, "MID-2");
        return scenicSign(g, this.levelName, x + 8, 363);
      },
      ground(g, off) {
        g.px(0, FLOOR, W, H - FLOOR, "GROUND");
        g.repeat(off, 44, 44, x => g.px(x, FLOOR + 6, 30, 5, "GROUND-DETAIL"));
        g.px(0, FLOOR + 18, W, 3, "GROUND-DETAIL");
      },
      fore(g, off) {
        g.px(0, FLOOR + 26, W, 4, "TRIM");
        g.repeat(off, 96, 40, x => g.px(x, FLOOR + 26, 6, 20, "TRIM"));
      }
    },
    {
      id: "env-b-marble-forum-16",
      name: "Marble Forum",
      levelName: "The Art of the Column",
      level: 2,
      obstacleId: "obst-broken-drum-66",
      obstacleName: "Broken drum",
      premise: "Sunbaked classical ruins on a dry hillside. Invented capitals and proportions only - no traceable real structure.",
      obstacleNote: "A 56 px drum stack under a 66 px chamfered coping with a drip groove. Seams every 14 px give a rhythm the eye can count; spalled course ends are 3 px blocks in the 5 px margin, so a chip can never open a hole in the lethal body.",
      readability: "Warmest stone of the six and so the weakest separator for the face. Only safe if the 2 px OBST-EDGE is enforced on every gap-facing surface and the mid layer stays below L 55.",
      scores: { separation: "Fair", charm: "High", clutter: "Medium", themeRange: "Good" },
      nightLabel: "Night",
      ramps: {
        day: ramp("#7fc3d9", "#bfe2e8", "#f2ead4", "#cfe3e2", "#9fb9a6", "#7e9c8a", "#6d8a76", "#4f6a5b",
          "#efe7d6", "#d3c8b4", "#9c8f79", "#3d3428", "#35604a", "#b9a98f", "#8f7f68", "#221c14"),
        night: ramp("#151d2e", "#293650", "#dfe4f0", "#33405c", "#3a4a5e", "#4a5d72", "#2c3a4a", "#1f2a37",
          "#8f95a0", "#6b7280", "#474e5c", "#d6dbe4", "#4f9c78", "#232b33", "#343d47", "#0a0f14")
      },
      glow: [346, 72, 20],
      clouds: [[0, 82, 0, .8]],
      far(g, off) {
        g.repeat(off, 336, 90, x => {
          for (let i = 0; i < 2; i++) {
            const bx = x + i * 168, peak = 306 + i * 14;
            for (let s = 0; s < 40; s++) {
              const hh = Math.round(Math.sin((s / 40) * Math.PI) * (56 - i * 12));
              g.px(bx + s * 4, peak + (56 - hh), 4, 372 - peak - (56 - hh), i ? "FAR-2" : "FAR-1");
            }
          }
        });
      },
      mid(g, off) {
        // An arched arcade, not another row of gap-shaped floating lintels.
        g.repeat(off, 144, 50, x => {
          g.px(x, 402, 144, 10, "MID-1");
          g.px(x, 412, 18, FLOOR - 412, "MID-1");
          g.px(x + 126, 412, 18, FLOOR - 412, "MID-1");
          for (let i = 0; i < 5; i++) {
            g.px(x + 18 + i * 8, 412, 8, 20 - i * 4, "MID-1");
            g.px(x + 118 - i * 8, 412, 8, 20 - i * 4, "MID-1");
          }
        });
      },
      landmark(g, x) {
        // Low museum pavilion with a pediment and a named frieze.
        pitchedRoof(g, x, 330, 224, 28);
        g.px(x, 358, 224, 40, "MID-1");
        for (let i = 0; i < 5; i++) {
          g.px(x + 8 + i * 48, 398, 16, 62, "MID-1");
          g.px(x + 5 + i * 48, 398, 22, 4, "MID-2");
        }
        g.px(x - 4, 460, 232, 8, "MID-2");
        return scenicSign(g, this.levelName, x + 8, 365);
      },
      ground(g, off) {
        g.px(0, FLOOR, W, H - FLOOR, "GROUND");
        g.repeat(off, 26, 26, x => g.px(x, FLOOR + 8, 4, 3, "GROUND-DETAIL"));
        g.repeat(off * .8, 61, 61, x => g.px(x, FLOOR + 18, 9, 3, "GROUND-DETAIL"));
      },
      fore(g, off, t) {
        // Heat shimmer: a 1 px horizontal jitter on the bottom band only.
        for (let y = H - 10; y < H; y++) {
          const j = g.reduced ? 0 : Math.round(Math.sin(t * 3 + y * .9));
          g.px(wrap(-off, 40) + j, y, W, 1, "GROUND-DETAIL", .25);
        }
      }
    },
    {
      id: "env-c-executive-atrium-16",
      name: "Executive Atrium",
      levelName: "Executive Airspace",
      level: 3,
      obstacleId: "obst-elevator-pylon-66",
      obstacleName: "Elevator pylon",
      premise: "He never left the building. A marble corporate lobby with a glass roof, flown at mezzanine height while the planters go by.",
      obstacleNote: "A 54 px mirrored shaft under a machined 66 px collar, 18 px tall, with a five-bolt flange row. The 6 px specular stripe is off-centre so it never reads as a gap; 3 px cable clips ride the margin as tagged decoration.",
      readability: "Cleanest of the six. Cool neutral steel against a warm character is the textbook separation, and the interior justifies a flat, uncluttered background.",
      scores: { separation: "Excellent", charm: "Medium", clutter: "Low", themeRange: "Good" },
      nightLabel: "After hours",
      ramps: {
        day: ramp("#dfe7ee", "#f2f6f8", "#ffffff", "#e6ecf1", "#c3ced8", "#a3b2bf", "#8b9aa8", "#6b7a89",
          "#cfd8e0", "#9fb0be", "#6a7e8e", "#2b3640", "#1f7a5c", "#b7bfc6", "#93a0a9", "#12181d"),
        night: ramp("#171d24", "#222a33", "#c2d2dd", "#2a333d", "#38434f", "#47545f", "#2e3843", "#232b34",
          "#7f8d99", "#5c6a76", "#3f4a55", "#dae3ea", "#38b98c", "#1c232a", "#2b343d", "#0a0e12")
      },
      sky(g, t) {
        // The "sky" is a coffered skylight: the scale joke is that this is indoors.
        sky(g, t);
        for (let x = 0; x < W; x += 112) g.px(x, 0, 2, HAZE_TOP, "FAR-2", .22);
        for (let y = 24; y < HAZE_TOP; y += 92) g.px(0, y, W, 2, "FAR-2", .22);
      },
      glow: null,
      clouds: null,
      far(g, off) {
        g.px(0, 336, W, 30, "FAR-1");
        g.repeat(off, 72, 20, x => g.px(x + 6, 340, 3, 22, "FAR-2"));
        g.px(0, 332, W, 5, "FAR-2");
      },
      mid(g, off) {
        g.px(0, 450, W, 18, "MID-1");
        g.repeat(off, 264, 70, x => {
          g.px(x + 8, 430, 38, 38, "MID-2");
          g.px(x + 4, 425, 46, 6, "MID-1");
          g.px(x + 25, 390, 4, 35, "MID-2");
          g.px(x + 14, 384, 26, 20, "MID-1");
          g.px(x + 20, 378, 14, 8, "MID-1");
          // Upholstered bench on a continuous mezzanine floor.
          g.px(x + 94, 430, 64, 18, "MID-2");
          g.px(x + 98, 448, 4, 20, "MID-2");
          g.px(x + 150, 448, 4, 20, "MID-2");
        });
      },
      landmark(g, x) {
        // Elevator-bank directory mounted on the lintel, over recessed doors.
        g.px(x, 346, 224, 122, "MID-1");
        g.px(x + 6, 352, 212, 7, "FAR-2");
        for (let i = 0; i < 3; i++) {
          g.px(x + 14 + i * 68, 402, 60, 66, "MID-2");
          g.px(x + 20 + i * 68, 408, 48, 60, "FAR-2");
          g.px(x + 43 + i * 68, 408, 2, 60, "MID-1");
        }
        return scenicSign(g, this.levelName, x + 8, 368);
      },
      ground(g, off) {
        g.px(0, FLOOR, W, H - FLOOR, "GROUND");
        // Polished floor: the reflected band scrolls at half the ground rate.
        g.px(0, FLOOR + 4, W, 9, "GROUND-DETAIL", .8);
        g.repeat(off * .5, 74, 74, x => g.px(x, FLOOR + 4, 34, 9, "SKY-GLOW", .18));
        g.repeat(off, 74, 74, x => g.px(x, FLOOR, 2, H - FLOOR, "GROUND-DETAIL"));
      },
      fore(g, off) {
        g.px(0, FLOOR + 28, W, 5, "TRIM", .9);
        g.repeat(off, 120, 60, x => g.px(x, FLOOR + 28, 40, 16, "TRIM", .35));
      }
    },
    {
      id: "env-d-links-and-lightning-16",
      name: "Links & Lightning",
      levelName: "The Back Nine",
      level: 4,
      obstacleId: "obst-topiary-pillar-66",
      obstacleName: "Topiary pillar",
      fallback: true,
      premise: "A coastal golf links in a squall, and he is not going in. Sport is the most plausible answer to \"where would this man be\" and needs zero political scaffolding.",
      obstacleNote: "A 56 px clipped yew under a 66 px crown at the ceiling and over a 66 px planter base at the floor. Vines are 1 px meanders on the outer faces with 1-3 px leaves, all inside the solid body; the only things that break the silhouette are 2-4 px leaf clumps in the margin, tagged decorative and excluded from collision.",
      readability: "The strongest separation of the six. Green is the direct complement of the rider's gold comb-over, so the most identity-bearing pixels on the character sit at maximum hue distance from the most dangerous pixels in the world.",
      scores: { separation: "Excellent", charm: "High", clutter: "Low", themeRange: "Good" },
      nightLabel: "Night",
      exceptions: [
        { rule: 2, theme: "day", slot: "SKY-HI", why: "The premise is a squall, so the day ceiling is deliberately a storm value rather than a bright sky." }
      ],
      ramps: {
        day: ramp("#4d6a86", "#8ea6b8", "#e8f0f5", "#b6c6d1", "#9aa987", "#7b8b6a", "#5f7f4f", "#46603a",
          "#6f9455", "#4f7340", "#33502d", "#1b2c1a", "#8fd6ff", "#7a7f63", "#5c6149", "#131a12"),
        night: ramp("#101a26", "#1e2c3a", "#c8d6e2", "#27384a", "#2f4340", "#3c5450", "#26382f", "#1b2a23",
          "#4a6b48", "#35503a", "#22362a", "#b9d8ae", "#5fc8f0", "#1a221c", "#28322a", "#080d09")
      },
      glow: [88, 58, 17],
      clouds: [[0, 58, 0, 1.2], [110, 96, 0, .9]],
      weather(g, off, t) {
        // Sparse diagonal rain on the haze layer.
        if (g.reduced) return;
        for (let i = 0; i < 22; i++) {
          const x = wrap(i * 61 - t * 190, W + 60) - 30;
          const y = wrap(i * 37 + t * 300, FLOOR);
          g.px(x, y, 1, 5, "HAZE", .5);
          g.px(x + 1, y + 5, 1, 3, "SKY-GLOW", .22);
        }
      },
      far(g, off) {
        g.repeat(off, 296, 80, x => {
          for (let s = 0; s < 74; s++) {
            const hh = Math.round(Math.sin((s / 74) * Math.PI) * 34) + 8;
            g.px(x + s * 4, 372 - hh, 4, hh + 6, "FAR-1");
          }
        });
      },
      mid(g, off) {
        g.px(0, 396, W, FLOOR - 396, "MID-1");
        g.repeat(off, 292, 70, x => {
          g.px(x + 4, 420, 90, 5, "FAR-1");
          g.px(x + 14, 416, 70, 4, "FAR-1");
          g.px(x + 42, 380, 2, 36, "MID-2");
          g.px(x + 44, 380, 16, 7, "FAR-2");
          g.px(x + 112, 444, 78, 5, "MID-2");
        });
      },
      landmark(g, x) {
        // Clubhouse porch: one broad roof, fascia and open veranda.
        pitchedRoof(g, x, 320, 224, 40);
        g.px(x, 364, 224, 38, "MID-1");
        g.px(x + 32, 402, 160, 66, "MID-2");
        for (let i = 0; i < 4; i++) g.px(x + 42 + i * 38, 416, 26, 36, "FAR-2");
        g.px(x + 8, 402, 8, 66, "MID-1");
        g.px(x + 208, 402, 8, 66, "MID-1");
        g.px(x, 460, 224, 8, "MID-1");
        return scenicSign(g, this.levelName, x + 8, 369);
      },
      ground(g, off) {
        g.px(0, FLOOR, W, H - FLOOR, "GROUND");
        g.px(0, FLOOR + 10, W, 7, "GROUND-DETAIL");
        g.repeat(off, 58, 58, x => g.px(x, FLOOR + 11, 12, 2, "TRIM", .55));
      },
      fore(g, off, t) {
        g.repeat(off, 22, 22, x => {
          const lean = g.reduced ? 0 : Math.round(Math.sin(t * 4 + x * .3) * 2);
          g.px(x + lean, FLOOR + 24, 2, 18, "MID-2");
          g.px(x + 6 - lean, FLOOR + 30, 2, 12, "MID-2");
        });
      }
    },
    {
      id: "env-e-penthouse-row-16",
      name: "Penthouse Row",
      levelName: "Penthouse Peril",
      level: 5,
      obstacleId: "obst-rooftop-stack-66",
      obstacleName: "Rooftop stack",
      premise: "A rooftop run above a city at dusk - stepped terraces, lidded water tanks and a supported rooftop marquee. Night-native, so the \"day\" ramp is dusk rather than noon.",
      obstacleNote: "A 56 px scaffolded stack under a flared 66 px vent hood, 22 px tall, with a louvred back and a painted TRIM band. The lattice lives on the outer faces only; 3 px hood brackets sit in the margin as tagged decoration.",
      readability: "Both ramps are dark, so the rim-lit OBST-EDGE does all the work. The warm rider sits above restrained roof silhouettes; readable lettering is reserved for one supported sign, never repeated neon.",
      scores: { separation: "Fair", charm: "Medium", clutter: "Low", themeRange: "Poor (dark only)" },
      dayLabel: "Dusk",
      nightLabel: "Night",
      exceptions: [
        { rule: 2, theme: "day", slot: "SKY-HI", why: "Night-native concept: the \"day\" ramp is dusk rather than noon, so the sky never reaches the light extreme." },
        { rule: 2, theme: "day", slot: "SKY-LO", why: "Night-native concept: the \"day\" ramp is dusk rather than noon, so the sky never reaches the light extreme." },
        { rule: 4, theme: "day", slot: "OBST-EDGE", why: "Both ramps are dark, so the edge rim-lights in both instead of flipping polarity. The brief calls this the concept that most depends on rule 4." }
      ],
      ramps: {
        day: ramp("#3a3560", "#8a5f80", "#f6c9c4", "#6b5578", "#4b4470", "#5f5687", "#33304f", "#23213a",
          "#4a5a86", "#344061", "#232c45", "#9fb6e0", "#23e0c8", "#1b1a2c", "#2c2b46", "#0a0913"),
        night: ramp("#0e1024", "#1c1c3a", "#c9d4ef", "#262a4c", "#2b2f56", "#3a3f6d", "#1e2140", "#15172c",
          "#3d4a72", "#2a3352", "#1c2338", "#b9c9ec", "#23e0c8", "#121122", "#1e1d38", "#06060e")
      },
      glow: [78, 92, 15],
      clouds: [[0, 118, 0, 1]],
      far(g, off) {
        g.repeat(off, 272, 70, x => {
          for (let i = 0; i < 3; i++) {
            const h = 54 + ((i * 37) % 58), bx = x + i * 82;
            g.px(bx, 372 - h, 64, h, "FAR-1");
            g.px(bx + 8, 362 - h, 48, 10, "FAR-1");
            for (let wy = 382 - h; wy < 366; wy += 18) {
              for (let wx = 0; wx < 3; wx++) {
                // Fixed windows do not twinkle or re-seed as the skyline scrolls.
                if ((i + wx + wy) % 3) g.px(bx + 10 + wx * 17, wy, 6, 3, "FAR-2");
              }
            }
          }
        });
      },
      mid(g, off) {
        g.repeat(off - 96, 320, 80, x => {
          // A stepped roofline gives every tank and vent a visible footing.
          g.px(x, 412, 112, FLOOR - 412, "MID-1");
          g.px(x + 112, 438, 94, FLOOR - 438, "MID-1");
          g.px(x + 206, 422, 114, FLOOR - 422, "MID-1");
          g.px(x, 412, 112, 5, "MID-2");
          g.px(x + 112, 438, 94, 5, "MID-2");
          g.px(x + 206, 422, 114, 5, "MID-2");
          waterTank(g, x + 32, 412);
          g.px(x + 244, 407, 32, 15, "MID-2");
          g.px(x + 240, 403, 40, 5, "MID-1");
          g.px(x + 248, 411, 24, 2, "FAR-2");
        });
      },
      landmark(g, x) {
        // A filled rooftop billboard, on two legs bolted into a broad penthouse.
        g.px(x, 414, 224, FLOOR - 414, "MID-1");
        g.px(x - 4, 410, 232, 5, "MID-2");
        g.px(x + 32, 390, 5, 20, "MID-2");
        g.px(x + 187, 390, 5, 20, "MID-2");
        for (let i = 0; i < 4; i++) g.px(x + 22 + i * 50, 432, 30, 18, "FAR-2");
        return scenicSign(g, this.levelName, x + 8, 363);
      },
      ground(g, off) {
        g.px(0, FLOOR, W, H - FLOOR, "GROUND");
        g.repeat(off, 13, 13, x => g.px(x, FLOOR + 5, 3, 3, "GROUND-DETAIL"));
        g.repeat(off * .9, 31, 31, x => g.px(x, FLOOR + 14, 6, 3, "GROUND-DETAIL"));
      },
      fore(g, off) {
        // Slack cable crossing the top 8 px only, never over the gap.
        if (g.reduced) off = 0;
        for (let x = 0; x < W; x++) {
          const y = 2 + Math.round(Math.sin((x + off * .3) * .012) * 3 + 3);
          g.px(x, y, 1, 2, "INK", .8);
        }
      }
    },
    {
      id: "env-f-gantry-nine-16",
      name: "Gantry Nine",
      levelName: "The Biggest Launch",
      level: 6,
      obstacleId: "obst-gantry-tower-66",
      obstacleName: "Gantry tower",
      premise: "A launch complex on a coastal flat: service towers, hold-down clamps, cryo frost. Generic industrial forms only, no identifiable vehicle or facility.",
      obstacleNote: "A 54 px truss tower under a grated 66 px maintenance platform with a kick rail. Truss texture is 2 px diagonals on the outer faces and cryo frost stays well away from the cap; 3 px handrail stanchions ride the 6 px margin as tagged decoration.",
      readability: "White steel is the highest-value obstacle in the set, excellent against the navy jacket and poor against the shirt and the pale hair highlight. The OBST-EDGE resolves it, but this concept has the least margin if that edge is ever dropped.",
      scores: { separation: "Good", charm: "Medium", clutter: "Medium", themeRange: "Good" },
      nightLabel: "Night",
      ramps: {
        day: ramp("#9dc9e8", "#dbe9f2", "#f7f2e4", "#c7dae6", "#93a8b5", "#75899a", "#8f9c86", "#6c7a66",
          "#d8dde0", "#aab3b9", "#6f7b83", "#2a3238", "#2ea8ff", "#b3b0a4", "#8b887c", "#14181b"),
        night: ramp("#101923", "#1d2a37", "#d3dde8", "#28394a", "#33454f", "#425663", "#2a3840", "#1e2930",
          "#93a0a8", "#6d7a83", "#4a555d", "#dde5ea", "#4fc0ff", "#1f262b", "#2e373d", "#080c0f")
      },
      glow: [368, 60, 18],
      clouds: [[0, 70, 0, .9], [130, 104, 0, .6]],
      weather(g, off, t) {
        // Two contrails drift on the far layer.
        for (let i = 0; i < 2; i++) {
          const y = 46 + i * 26;
          const x = g.reduced ? i * 180 + 40 : wrap(t * 3 + i * 210, W + 200) - 100;
          g.px(x, y, 96, 2, "SKY-GLOW", .34);
          g.px(x + 96, y, 6, 2, "SKY-GLOW", .6);
        }
      },
      far(g, off) {
        g.repeat(off, 352, 70, x => {
          g.px(x, 344, 116, 28, "FAR-1");
          g.px(x + 8, 336, 100, 8, "FAR-1");
          // Distant launch vehicle and service mast, in far values only.
          g.px(x + 172, 294, 18, 78, "FAR-1");
          g.px(x + 176, 286, 10, 8, "FAR-1");
          g.px(x + 180, 282, 2, 4, "FAR-1");
          g.px(x + 154, 302, 6, 70, "FAR-2");
          g.px(x + 160, 316, 12, 4, "FAR-2");
          g.px(x + 168, 362, 26, 10, "FAR-1");
        });
      },
      mid(g, off, t) {
        g.px(0, 398, W, FLOOR - 398, "MID-1");
        g.px(0, 398, W, 5, "MID-2");
        g.repeat(off, 288, 60, x => {
          g.px(x + 10, 404, 44, 6, "MID-2");
          const wind = g.reduced ? 0 : Math.round(Math.sin(t * .7));
          g.px(x + 72, 372, 3, 26, "MID-2");
          for (let i = 0; i < 4; i++) g.px(x + 75 + i * 5, 374 + i + wind, 5, 5 - i, "FAR-2");
          if (!g.reduced) for (let i = 0; i < 2; i++) {
            const p = wrap(t * .6 + i * .5, 1);
            g.px(x + 24, 404 - p * 18, 7, 5, "SKY-GLOW", (1 - p) * .28);
          }
        });
      },
      landmark(g, x) {
        // Low mission-control hangar with a stepped roof and large shutter door.
        g.px(x, 358, 224, 110, "MID-1");
        g.px(x + 16, 348, 192, 10, "MID-1");
        g.px(x + 28, 340, 168, 8, "MID-1");
        g.px(x + 40, 403, 144, 65, "MID-2");
        for (let y = 410; y < 468; y += 12) g.px(x + 44, y, 136, 2, "FAR-2");
        return scenicSign(g, this.levelName, x + 8, 366);
      },
      ground(g, off) {
        g.px(0, FLOOR, W, H - FLOOR, "GROUND");
        g.repeat(off, 66, 66, x => g.px(x, FLOOR, 3, H - FLOOR, "GROUND-DETAIL"));
        g.px(0, FLOOR + 20, W, 3, "GROUND-DETAIL");
      },
      fore(g, off) {
        g.px(0, FLOOR + 24, W, 3, "OBST-SHADE");
        g.repeat(off, 12, 12, x => {
          g.px(x, FLOOR + 27, 2, 16, "OBST-SHADE", .55);
          g.px(x + 6, FLOOR + 27, 2, 16, "OBST-SHADE", .35);
        });
      }
    }
  ];

  const byId = {};
  for (const env of ENVS) byId[env.id] = env;

  /* Ten cleared obstacles per environment; the sixth lasts for the rest of the run. */
  const PIPES_PER_LEVEL = 10;
  const CAMPAIGN_STATUS = "Live";

  const CAMPAIGN = ENVS.slice().sort((a, b) => a.level - b.level).map(env => {
    const unlockAt = (env.level - 1) * PIPES_PER_LEVEL;
    const clearAt = env.level === ENVS.length ? null : env.level * PIPES_PER_LEVEL;
    Object.assign(env, {
      unlockAt, clearAt,
      pipeFrom: unlockAt, pipeTo: clearAt === null ? null : clearAt - 1,
      pipeRange: clearAt === null ? unlockAt + "+" : unlockAt + "-" + (clearAt - 1)
    });
    return {
      level: env.level,
      environmentId: env.id,
      obstacleId: env.obstacleId,
      name: env.levelName,
      unlockAt, clearAt
    };
  });

  /* Clamp at Gantry Nine rather than looping after sixty obstacles. */
  function levelAt(pipes) {
    const index = Math.min(CAMPAIGN.length - 1, Math.max(0, Math.floor(pipes / PIPES_PER_LEVEL)));
    return CAMPAIGN[index];
  }

  /* ------------------------------------------------------------- obstacles */

  /* Deterministic gap layout so previews are reproducible frame to frame. */
  function gapsFor(scroll, gapSize) {
    const out = [];
    const first = Math.floor(scroll / SPACING) - 1;
    for (let i = first; i < first + 4; i++) {
      const x = Math.round(i * SPACING - scroll);
      if (x > W + COLLIDE || x < -COLLIDE * 2) continue;
      const top = Math.round(96 + hash(i * 3.7) * (FLOOR - gapSize - 210));
      out.push({ x, top, gap: gapSize });
    }
    return out;
  }

  /* --------------------------------------------------------------- scene */

  /* stageTime: nonnegative elapsed seconds since THIS environment's entry.
   * Omit for a fixed preview. Hold 8s, then move the entire landmark left at 12px/s
   * without wrapping. Reduced motion keeps it fixed. During a crossfade, supply
   * each layer's own elapsed time; the caller owns entry/reset/pause bookkeeping. */
  function drawScene(ctx, opts) {
    if (opts.stageTime !== undefined && (!Number.isFinite(opts.stageTime) || opts.stageTime < 0)) {
      throw new RangeError("stageTime must be nonnegative elapsed seconds");
    }
    const env = typeof opts.env === "string" ? byId[opts.env] : opts.env;
    const theme = opts.theme === "night" ? "night" : "day";
    const P = env.ramps[theme];
    const t = opts.time || 0;
    const reduced = !!opts.reduced;
    const scroll = opts.scroll === undefined ? t * 150 : opts.scroll;
    const g = painter(ctx, P, reduced);
    // Decorative layers freeze under reduced motion; obstacles and ground still move.
    const dec = reduced ? 0 : scroll;

    ctx.imageSmoothingEnabled = false;
    (env.sky || sky)(g, t);
    if (env.glow) disc(g, env.glow[0], env.glow[1], env.glow[2]);
    if (env.clouds) clouds(g, dec * RATES.clouds, env.clouds);
    if (env.weather) env.weather(g, dec * RATES.haze, t);
    env.far(g, dec * RATES.far, t);
    env.mid(g, dec * RATES.mid, t);
    const landmarkX = LANDMARK.x - (reduced ? 0 : Math.max(0, (opts.stageTime || 0) - LANDMARK.hold) * LANDMARK.speed);
    const sign = landmarkX + LANDMARK.width > 0 ? env.landmark(g, landmarkX) : null;
    env.ground(g, scroll * RATES.world);

    const gapSize = opts.gap || 158;
    const obstacle = OBSTACLES[env.obstacleId];
    const pairs = opts.gaps || gapsFor(scroll, gapSize);
    g.marks = [];
    const boxes = [];
    for (const pair of pairs) {
      obstacle(g, pair.x, pair.top, pair.gap, FLOOR);
      boxes.push(...hitboxes(env.obstacleId, pair.x, pair.top, pair.gap, FLOOR));
    }

    g.px(0, FLOOR, W, 3, "INK");
    g.px(0, FLOOR + 3, W, 3, "TRIM", .55);
    if (env.fore) env.fore(g, scroll * RATES.fore, t);
    if (opts.rider) opts.rider(ctx, opts.riderX === undefined ? 108 : opts.riderX,
      opts.riderY === undefined ? 236 : opts.riderY);
    return {
      env, theme, palette: P, sign,
      shaft: SHAFT[env.obstacleId], capHeight: CAP_H[env.obstacleId], width: COLLIDE,
      hitboxes: boxes, decor: g.marks.slice()
    };
  }

  /* Transparent obstacle pair, retaining its spawn-time environment during transitions. */
  function drawPair(ctx, opts) {
    const env = typeof opts.env === "string" ? byId[opts.env] : opts.env;
    const theme = opts.theme === "night" ? "night" : "day";
    const g = painter(ctx, env.ramps[theme], !!opts.reduced);
    ctx.imageSmoothingEnabled = false;
    OBSTACLES[env.obstacleId](g, opts.x, opts.top, opts.gap, FLOOR);
    return { hitboxes: hitboxes(env.obstacleId, opts.x, opts.top, opts.gap, FLOOR), decor: g.marks };
  }

  /* Isolated obstacle study for the Obstacles tab. */
  function drawObstacle(ctx, opts) {
    const env = typeof opts.env === "string" ? byId[opts.env] : opts.env;
    const theme = opts.theme === "night" ? "night" : "day";
    const g = painter(ctx, env.ramps[theme], true);
    const h = ctx.canvas.height, w = ctx.canvas.width;
    ctx.imageSmoothingEnabled = false;
    g.px(0, 0, w, h, "HAZE");
    const x = Math.round((w - COLLIDE) / 2);
    const top = Math.round(h * .34), gap = Math.round(h * .3);
    g.marks = [];
    OBSTACLES[env.obstacleId](g, x, top, gap, h);
    return {
      x, top, gap, width: COLLIDE,
      shaft: SHAFT[env.obstacleId], wing: wingOf(env.obstacleId), capHeight: CAP_H[env.obstacleId],
      hitboxes: hitboxes(env.obstacleId, x, top, gap, h), decor: g.marks.slice()
    };
  }

  /* -------------------------------------------------- legacy live renderer */

  /* Reproduces the shipping city exactly. Every number and token name comes from
   * the extracted baseline, so this cannot drift from production by hand. */
  function drawLegacy(ctx, opts) {
    const base = window.TRUMPET_BASELINE;
    if (!base) throw new Error("baseline.js must load before the legacy environment can render");
    const theme = opts.theme === "night" ? "dark" : "light";
    const T = base.themes[theme];
    const geo = base.geometry, envd = base.environment, ob = base.obstacle;
    const floorY = geo.floorY;
    const scroll = opts.scroll === undefined ? (opts.time || 0) * 150 : opts.scroll;
    const reduced = !!opts.reduced;
    const t = opts.time || 0;
    const R = (x, y, w, h, token, alpha) => {
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.fillStyle = T[token];
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      ctx.globalAlpha = 1;
    };
    ctx.imageSmoothingEnabled = false;
    R(0, 0, W, H, "bg-elevated");
    R(0, 0, W, envd.skyBandHeight, "accent-soft");
    for (const s of envd.sun) R(s[0], s[1], s[2], s[3], "warning");
    const rate = n => envd.layers.find(l => l.name === n).rate;
    const drift = reduced ? 0 : scroll * rate("Clouds");
    for (let i = 0; i < envd.cloudCount; i++) {
      const x = wrap(i * 123 - drift, 610) - 90, y = 66 + (i % 3) * 58, size = 1 + (i % 2) * .35;
      R(x + 12 * size, y, 24 * size, 8 * size, "surface");
      R(x + 4 * size, y + 8 * size, 44 * size, 8 * size, "surface");
      R(x, y + 16 * size, 58 * size, 8 * size, "surface");
      R(x + 8 * size, y + 24 * size, 44 * size, 3 * size, "border");
    }
    for (let i = 0; i < envd.farCount; i++) {
      const x = i * 48 - wrap(reduced ? 0 : scroll * rate("Far buildings"), 48), h = 24 + (i % 4) * 14;
      R(x, floorY - h - 30, 40, h + 30, "border");
      R(x + 8, floorY - h - 22, 5, 7, "bg-elevated");
      R(x + 23, floorY - h - 22, 5, 7, "bg-elevated");
    }
    for (let i = 0; i < envd.midCount; i++) {
      const x = i * 58 - wrap(reduced ? 0 : scroll * rate("Near rooftops"), 58);
      R(x, floorY - 20, 58, 20, "border-strong");
      R(x + 8, floorY - 30, 34, 12, "border-strong");
    }
    const shaftW = ob.shaftWidth, capW = ob.capWidth, capH = ob.capHeight, capDx = ob.capOffsetX;
    const legacyPipe = (x, y, height, top) => {
      R(x, y, shaftW, height, "accent-hover");
      R(x + 4, y, shaftW - 8, height, "accent");
      R(x + 8, y, 6, height, "warning");
      const capY = top ? y + height - capH : y;
      R(x + capDx, capY, capW, capH, "accent-hover");
      R(x, capY + 4, shaftW, 10, "accent");
      R(x + 4, capY + 4, 6, 10, "warning");
    };
    const gapSize = opts.gap || geo.gapAtZero;
    for (const pair of (opts.gaps || gapsFor(scroll, gapSize))) {
      // gapsFor reports the lethal column's left edge; the shipping pipe is drawn from pipe.x.
      const px = pair.x - capDx;
      legacyPipe(px, 0, pair.top, true);
      legacyPipe(px, pair.top + pair.gap, floorY - pair.top - pair.gap, false);
    }
    if (opts.rider) opts.rider(ctx, opts.riderX === undefined ? geo.riderX : opts.riderX,
      opts.riderY === undefined ? 236 : opts.riderY);
    R(0, floorY, W, 4, "text");
    R(0, floorY + 4, W, 8, "accent");
    R(0, floorY + 12, W, H - floorY - 12, "bg");
    void t;
  }

  /* ----------------------------------------------------------- palette audit */

  function hsv(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) / 255, g2 = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g2, b), min = Math.min(r, g2, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = 60 * (((g2 - b) / d) % 6);
      else if (max === g2) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g2) / d + 4);
    }
    return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
  }

  /* Rule 1: the character owns hue 20-55 above 45% saturation. Rule 2: skies stay at
   * the value extremes. Rule 4: OBST-EDGE is darkest by day and lightest at night.
   *
   * Concepts may bend a rule where the brief says so - a storm ceiling, a dusk-native
   * ramp - so those are returned tagged as documented rather than silently dropped.
   * Anything untagged is a real defect. */
  function audit(env) {
    const issues = [];
    const add = (theme, slot, rule, detail) => {
      const doc = (env.exceptions || []).find(e => e.rule === rule && e.slot === slot && e.theme === theme);
      issues.push({ theme, slot, rule, detail, documented: !!doc, why: doc ? doc.why : null });
    };
    for (const theme of ["day", "night"]) {
      const P = env.ramps[theme];
      for (const slot of SLOTS) {
        const c = hsv(P[slot]);
        if (c.h >= 20 && c.h <= 55 && c.s > (slot === "SKY-GLOW" ? .25 : .45)) {
          add(theme, slot, 1, "enters the rider's reserved gold band");
        }
      }
      for (const slot of ["SKY-HI", "SKY-LO"]) {
        const v = hsv(P[slot]).v;
        if (theme === "day" && v < .72) add(theme, slot, 2, "day sky is not at the light extreme");
        if (theme === "night" && v > .40) add(theme, slot, 2, "night sky is not at the dark extreme");
      }
      const edge = hsv(P["OBST-EDGE"]).v, body = hsv(P["OBST-BASE"]).v;
      if (theme === "day" && edge >= body) add(theme, "OBST-EDGE", 4, "day edge is not darker than the body");
      if (theme === "night" && edge <= body) add(theme, "OBST-EDGE", 4, "night edge does not rim-light above the body");
    }
    return issues;
  }

  window.TRUMPET_ENVIRONMENTS = {
    slots: SLOTS, list: ENVS, byId, obstacles: OBSTACLES,
    rates: RATES,
    world: { W, H, FLOOR, COLLIDE, EDGE, SPACING, LIP, SHAFT, CAP_H, DECOR_CLEAR },
    campaign: CAMPAIGN, pipesPerLevel: PIPES_PER_LEVEL, campaignStatus: CAMPAIGN_STATUS, levelAt,
    drawScene, drawPair, drawObstacle, drawLegacy, gapsFor, hitboxes, audit, hsv
  };
})();
