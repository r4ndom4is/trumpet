/* Quiet, materially authored pixel scenery extracted from the approved playable art.
 * Seven places share the accepted palace's restrained depth and upper-right light.
 * Architecture stays low; broad sky is flight space. Material detail belongs on
 * hazards, whose opaque silhouettes come directly from canonical collision boxes.
 * Grounds never contain obstacles. All recurring raster work is cached.
 */
(() => {
  "use strict";
  const E = window.TRUMPET_ENVIRONMENTS;
  const STRAIT_ID = "env-g-hormuz-strait-16";
  const { W, H, FLOOR, COLLIDE, SHAFT, CAP_H } = E.world;
  const PARALLAX = { far: .06, mid: .16, near: .34, ground: 1 };
  const MAX_BACKGROUND_PAIRS = 4;
  const repeatingContexts = new WeakSet();
  const modulo = (n, period) => ((n % period) + period) % period;
  const hash = n => { const s = Math.sin(n * 91.17 + 17.31) * 43758.5453; return s - Math.floor(s); };
  const mix = (a, b, t) => {
    const aa = a.match(/\w\w/g).map(v => parseInt(v, 16));
    const bb = b.match(/\w\w/g).map(v => parseInt(v, 16));
    return "#" + aa.map((v, i) => Math.round(v + (bb[i] - v) * t).toString(16).padStart(2, "0")).join("");
  };
  const rect = (c, x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = color;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (!repeatingContexts.has(c)) { c.fillRect(x, y, w, h); return; }
    // Wrap each mark while authoring the tile, so branches, roofs and shoreline
    // contours crossing its edge remain whole instead of ending at a hard seam.
    x = modulo(x, W);
    if (w >= W) c.fillRect(0, y, W, h);
    else {
      c.fillRect(x, y, Math.min(w, W - x), h);
      if (x + w > W) c.fillRect(0, y, x + w - W, h);
    }
  };
  // Scanline polygons and ellipses preserve the same one-logical-pixel grid as
  // the accepted artwork, including diagonals. No anti-aliased vector edges.
  function poly(c, points, color) {
    const lo = Math.floor(Math.min(...points.map(p => p[1])));
    const hi = Math.ceil(Math.max(...points.map(p => p[1])));
    for (let y = lo; y < hi; y++) {
      const cuts = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y + .5 && b[1] > y + .5) || (b[1] <= y + .5 && a[1] > y + .5))
          cuts.push(a[0] + (y + .5 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length; i += 2)
        rect(c, Math.ceil(cuts[i]), y, Math.ceil(cuts[i + 1]) - Math.ceil(cuts[i]), 1, color);
    }
  }
  function oval(c, x, y, w, h, color) {
    for (let yy = 0; yy < h; yy++) {
      const dx = Math.sqrt(Math.max(0, 1 - ((yy + .5 - h / 2) / (h / 2)) ** 2)) * w / 2;
      rect(c, Math.round(x + w / 2 - dx), y + yy, Math.max(1, Math.round(2 * dx)), 1, color);
    }
  }
  function line(c, x, y, xx, yy, color, width = 1) {
    const steps = Math.max(Math.abs(xx - x), Math.abs(yy - y), 1);
    for (let i = 0; i <= steps; i++) rect(c, x + (xx - x) * i / steps, y + (yy - y) * i / steps, width, width, color);
  }
  function canvas(w = W, h = H) {
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    return out;
  }
  function safe(ctx, draw) {
    ctx.save();
    try {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = false;
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.filter = "none";
      draw();
    } finally { ctx.restore(); }
  }
  const MATERIALS = {
    day: {
      stone: ["#a1ada2", "#bcc4b2", "#d4d7c0", "#e2dfc6"],
      pink: ["#a59b8e", "#b9aa97", "#cdbba2", "#dcc7aa"],
      roof: ["#7d9190", "#97a8a0", "#b3bcb0", "#c4cbbc"],
      tile: ["#9c8981", "#ad9485", "#bca48d", "#cdb59d"],
      leaf: ["#657f68", "#789174", "#8da381", "#a4b294"],
      grass: ["#7e9271", "#91a17a", "#a2b08a", "#b4bd96"],
      glass: ["#849c9b", "#9aafaa", "#b5c5b9", "#c8d2c2"],
      steel: ["#83999e", "#9dafb0", "#b4c3be", "#cbd0c4"],
      wood: ["#8b9081", "#a09f89", "#b5b098", "#c9c0a5"],
      brick: ["#92988f", "#a6aaa0", "#b8bcb0", "#c6c9b8"],
      water: ["#7faaa9", "#94b9b5", "#aecac0", "#c2d5c5"],
      ground: ["#929c8b", "#a5ac97", "#b5bba3", "#cdcfb4"]
    },
    night: {
      stone: ["#374757", "#4a5c6c", "#65778a", "#8594a0"],
      pink: ["#494751", "#615b66", "#7b7180", "#91848f"],
      roof: ["#293b51", "#3a4d63", "#4d6379", "#687d91"],
      tile: ["#433e51", "#594b61", "#705b70", "#866d7e"],
      leaf: ["#263b40", "#344b50", "#435e61", "#5c7475"],
      grass: ["#2d4547", "#3b5654", "#4d6760", "#647d71"],
      glass: ["#34495d", "#465e71", "#607889", "#8298a4"],
      steel: ["#334854", "#485e6a", "#607783", "#80939d"],
      wood: ["#414b4c", "#525f5d", "#69726b", "#838879"],
      brick: ["#3c475c", "#515d70", "#647184", "#7d8998"],
      water: ["#293e54", "#3c556a", "#536e80", "#718994"],
      ground: ["#34474f", "#465b61", "#5a6e70", "#778986"]
    }
  };
  const HAZARDS = {
    "maritime-beacon": {
      day: ["#415e61", "#6b8885", "#9fb3a7", "#c1cbbb", "#dde0c9", "#f0ebd2", "#af8071"],
      night: ["#263d50", "#435f71", "#6c8794", "#92a9b0", "#bfcec9", "#dfe6d8", "#967f84"]
    },
    "obst-colonnade-66": {
      day: ["#555e58", "#869284", "#b5bba1", "#d1cba8", "#eee1b2", "#f6ebc6", "#719d91"],
      night: ["#263947", "#42586b", "#6a8294", "#8e9faf", "#becbd4", "#e0e4dd", "#6aafa8"]
    },
    "obst-broken-drum-66": {
      day: ["#536967", "#829894", "#b1bbb0", "#ced1bd", "#e2dfc6", "#f5ebce", "#8daba0"],
      night: ["#283c53", "#415b74", "#6b839e", "#91a5bb", "#bfccd5", "#e0e4e2", "#849faa"]
    },
    "obst-elevator-pylon-66": {
      day: ["#686c63", "#999b88", "#bcbda3", "#d2ccb1", "#e6dec1", "#f3ebd1", "#a48176"],
      night: ["#34464e", "#52676c", "#7b8a88", "#9ca59e", "#c1c5b6", "#e1dfca", "#a08c89"]
    },
    "obst-topiary-pillar-66": {
      day: ["#314e42", "#4b6d50", "#688754", "#83a166", "#a2b77d", "#c5cba0", "#b9aa8c"],
      night: ["#172d32", "#2e4a44", "#456756", "#61856b", "#8aab87", "#bbd0a8", "#7d9299"]
    },
    "obst-rooftop-stack-66": {
      day: ["#48565f", "#6c7e82", "#91a2a1", "#aeb9b1", "#c8cfc0", "#e4dfc4", "#899e97"],
      night: ["#242e46", "#3a4e67", "#5c718b", "#8294a8", "#a9bac5", "#d4dde0", "#6d9b9a"]
    },
    "obst-gantry-tower-66": {
      day: ["#415766", "#6f8893", "#9caeb2", "#bdc8c4", "#dce0cd", "#f1eed5", "#6fa7b0"],
      night: ["#223a4c", "#3c5a70", "#657f95", "#8fa6b7", "#bacbd5", "#e1e8e5", "#78bac7"]
    }
  };
  function masonry(c, x, y, w, h, p, rows = 12) {
    rect(c, x, y, w, h, p[1]);
    rect(c, x, y, 5, h, p[0]);
    rect(c, x + w - 4, y, 4, h, p[2]);
    rect(c, x, y, w, 2, p[3]);
    for (let yy = y + rows; yy < y + h; yy += rows) {
      rect(c, x + 5, yy, w - 9, 1, mix(p[0], p[1], .7));
      for (let xx = x + 12 + ((yy - y) / rows % 2) * 13; xx < x + w - 4; xx += 29)
        rect(c, xx, yy - rows + 2, 1, rows - 2, mix(p[0], p[1], .75));
    }
  }
  function windowPane(c, x, y, w, h, p, night, lit = false) {
    rect(c, x - 2, y - 2, w + 4, h + 4, p.stone[2]);
    rect(c, x, y, w, h, p.glass[0]);
    rect(c, x + 2, y + 1, w - 2, h - 2, lit && night ? "#8b8777" : p.glass[1]);
    rect(c, x + w - 2, y, 2, h, lit && night ? "#b4a58a" : p.glass[2]);
    rect(c, x + Math.floor(w / 2), y, 1, h, p.stone[1]);
    rect(c, x, y + Math.floor(h / 2), w, 1, p.stone[1]);
    rect(c, x - 2, y + h + 1, w + 5, 2, p.stone[3]);
  }
  function pitched(c, x, y, w, h, p) {
    poly(c, [[x,y+h],[x+16,y],[x+w-16,y],[x+w,y+h]], p[1]);
    poly(c, [[x+w*.66,y],[x+w-16,y],[x+w,y+h],[x+w*.7,y+h]], p[2]);
    for (let yy = y + 4; yy < y + h; yy += 4) {
      const inset = Math.ceil((y + h - yy) * 16 / h);
      rect(c, x + inset, yy, w - inset * 2, 1, mix(p[0], p[1], .55));
      for (let xx = x + inset + 6; xx < x + w - inset; xx += 12)
        rect(c, xx, yy - 2, 1, 2, p[2]);
    }
    rect(c, x + 15, y, w - 30, 2, p[3]);
    rect(c, x - 2, y + h, w + 4, 3, p[0]);
  }
  function arch(c, x, y, w, h, p) {
    oval(c, x, y, w, w, p[2]);
    rect(c, x, y + w / 2, w, h - w / 2, p[2]);
    oval(c, x + 3, y + 4, w - 6, w - 6, p[0]);
    rect(c, x + 3, y + w / 2, w - 6, h - w / 2, p[0]);
    rect(c, x + w - 4, y + w / 2, 2, h - w / 2, p[3]);
    rect(c, x - 1, y + h, w + 2, 2, p[3]);
  }
  function tree(c, x, y, w, h, p, seed = 1) {
    rect(c, x + w * .44, y + h * .48, 5, h * .52, p[0]);
    line(c, x + w / 2, y + h * .8, x + w * .24, y + h * .45, p[0], 2);
    const crown = (xx, yy, ww, hh, color, salt) => {
      const points = [];
      for (let j = 0; j < 28; j++) {
        const angle = j / 28 * Math.PI * 2, r = .89 + hash(j + salt) * .11;
        points.push([Math.round(xx + ww/2 + Math.cos(angle)*ww/2*r),
          Math.round(yy + hh/2 + Math.sin(angle)*hh/2*r)]);
      }
      poly(c, points, color);
    };
    for (let i = 0; i < 16; i++) {
      const a = hash(seed + i) * Math.PI * 2, rr = hash(seed + i + 30);
      const xx = x + w * .5 + Math.cos(a) * w * .30 * rr;
      const yy = y + h * .34 + Math.sin(a) * h * .25 * rr;
      const ww = w * (.29 + hash(i + seed + 6) * .20);
      crown(xx - ww/2, yy - ww/3, ww, ww*.66, p[xx > x+w*.53 ? 2 : 1], seed+i*9);
    }
    for (let i = 0; i < 15; i++) {
      const xx = x + w * (.2 + hash(i + seed + 103) * .65);
      const yy = y + h * (.13 + hash(i + seed + 170) * .36);
      rect(c, xx, yy, 4 + hash(i + 5) * 5, 2, mix(p[xx > x + w / 2 ? 3 : 0], p[1], .56));
    }
    for (let i = 0; i < 36; i++) {
      const xx = x+w*(.13+hash(i+seed+17)*.75), yy = y+h*(.11+hash(i+seed+273)*.39);
      rect(c, xx, yy, 2+hash(i+seed)*3, 1, mix(p[xx>x+w*.52?3:0],p[1],.65));
    }
  }
  function palm(c, x, y, h, p) {
    const top = y - h;
    for (let yy = top + 10; yy < y; yy += 3) {
      const bend = Math.round(5 * (1 - (yy - top) / h) ** 2);
      rect(c, x + bend, yy, 4, 3, p.wood[1]);
      rect(c, x + bend + 3, yy, 2, 3, p.wood[2]);
      rect(c, x + bend, yy, 3, 1, p.wood[0]);
    }
    for (let side of [-1, 1]) for (let f = 0; f < 4; f++) {
      const reach = 24 + f * 7;
      let px = x + 6, py = top + 10;
      for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        const xx = x + 6 + side * reach * t;
        const yy = top + 10 - Math.sin(t * Math.PI) * (15 - f * 3) + t * (f * 6);
        const thickness = Math.sin(t * Math.PI) * 5 + 1;
        poly(c, [[px,py-1],[xx,yy-1],[xx-side*3,yy+thickness],[px-side*3,py+thickness]],
          p.leaf[side > 0 ? 2 : 1]);
        if (i % 3 === 0) line(c, xx, yy+1, xx-side*3, yy+thickness+2, p.leaf[side > 0 ? 1 : 0]);
        px = xx; py = yy;
      }
    }
  }
  function ground(c, p, id) {
    rect(c, 0, FLOOR, W, H - FLOOR, p.ground[1]);
    rect(c, 0, FLOOR, W, 3, p.ground[3]);
    rect(c, 0, FLOOR + 3, W, 4, p.ground[2]);
    rect(c, 0, FLOOR + 7, W, 1, p.ground[0]);
    for (let y = FLOOR + 19; y < H; y += 16) {
      rect(c, 0, y, W, 1, mix(p.ground[0], p.ground[1], .55));
      for (let x = (y % 3) * 27; x < W; x += 83) rect(c, x, y - 11, 1, 11, p.ground[0]);
    }
    for (let i = 0; i < 65; i++) rect(c, hash(i+20)*W, FLOOR+10+hash(i+4)*32, 2+hash(i)*3, 1,
      mix(p.ground[i % 3], p.ground[1], .68));
    if (id.includes("gantry")) {
      rect(c, 0, 491, W, 2, p.steel[0]);
      for (let x = 8; x < W; x += 32) rect(c, x, 490, 9, 1, p.steel[2]);
    }
  }
  function palace(layers, p, assets) {
    if (assets) {
      for (const name of ["far", "mid", "near"]) layers[name].drawImage(assets[name], 0, 0, W, H);
      return;
    }
    let c = layers.far;
    // Complete no-asset fallback: portico, six columns, wings, roof and lawns.
    rect(c, 0, 385, W, 83, p.grass[1]);
    tree(c, -20, 318, 130, 100, p.leaf, 12);
    tree(c, 340, 308, 140, 113, p.leaf, 21);
    for (const x of [5, 307]) {
      masonry(c, x, 342, 136, 54, p.stone);
      for (let xx = x + 10; xx < x + 125; xx += 16) rect(c, xx, 352, 8, 34, p.stone[0]);
      rect(c, x - 2, 338, 141, 5, p.stone[3]);
    }
    c = layers.mid;
    masonry(c, 89, 298, 222, 97, p.stone);
    pitched(c, 87, 278, 226, 21, p.roof);
    for (let y = 312; y < 386; y += 27) for (const x of [102, 121, 140, 257, 276, 295])
      windowPane(c, x, y, 7, 13, p, false);
    rect(c, 150, 320, 102, 69, p.stone[0]);
    for (let x = 156; x <= 246; x += 18) {
      rect(c, x, 317, 7, 72, p.stone[1]);
      rect(c, x + 4, 317, 3, 72, p.stone[3]);
      rect(c, x - 2, 317, 11, 4, p.stone[2]);
    }
    poly(c, [[143,316],[199,289],[257,316]], p.stone[2]);
    poly(c, [[155,312],[199,294],[245,312]], p.stone[0]);
    poly(c, [[163,310],[199,297],[235,310]], p.stone[2]);
    for (let i = 0; i < 4; i++) rect(c, 144-i*4, 389+i*3, 114+i*8, 3, p.stone[i % 2 + 1]);
    c = layers.near;
    poly(c, [[189,403],[205,403],[316,468],[282,468]], p.grass[2]);
    for (let x = -10; x < W; x += 65) tree(c, x, 422, 78, 29, p.leaf, x + 99);
    rect(c, 0, 449, W, 2, p.leaf[1]);
    for (let x = 4; x < W; x += 24) rect(c, x, 442, 2, 26, p.leaf[1]);
  }
  function resort(layers, p, night) {
    let c = layers.far;
    rect(c, 0, 380, W, 88, p.grass[1]);
    for (let i = 0; i < 5; i++) {
      const x = i * 103 - 30, y = 322 + (i % 3) * 13;
      masonry(c, x, y, 70, 69, p.stone, 16);
      rect(c, x + 5, y - 5, 60, 5, p.stone[2]);
      for (let yy = y + 13; yy < 386; yy += 17) rect(c, x+8, yy, 52, 2, p.stone[0]);
    }
    c = layers.mid;
    masonry(c, 88, 285, 278, 120, p.pink, 13);
    masonry(c, 110, 269, 234, 22, p.stone, 9);
    rect(c, 107, 267, 240, 3, p.stone[3]);
    for (let x = 121; x < 333; x += 21) {
      rect(c, x, 260, 5, 9, p.stone[2]);
      rect(c, x, 259, 7, 2, p.stone[3]);
    }
    for (let y = 298; y < 349; y += 26) for (let x = 100; x < 358; x += 25)
      windowPane(c, x, y, 10, 15, p, night, (x + y) % 4 === 0);
    for (let x = 102; x < 355; x += 31) arch(c, x, 352, 20, 41, p.stone);
    // Brass balcony, recessed entrance, supported canopy.
    rect(c, 163, 348, 128, 4, p.tile[2]);
    rect(c, 160, 350, 134, 5, p.stone[3]);
    for (let x = 165; x < 292; x += 8) rect(c, x, 338, 1, 10, p.tile[1]);
    rect(c, 164, 338, 128, 1, p.tile[2]);
    rect(c, 181, 372, 94, 30, p.glass[0]);
    for (let x = 183; x < 274; x += 22) windowPane(c, x, 374, 17, 26, p, night, true);
    rect(c, 162, 368, 133, 5, p.stone[2]);
    rect(c, 166, 373, 5, 30, p.stone[1]);
    rect(c, 286, 373, 5, 30, p.stone[3]);
    for (let i = 0; i < 3; i++) rect(c, 160 - i * 8, 405 + i * 3, 135 + i * 16, 3, p.stone[2-i%2]);
    c = layers.near;
    palm(c, 48, 421, 111, p);
    palm(c, 385, 421, 123, p);
    for (let x of [15, 330]) {
      masonry(c, x, 431, 96, 22, p.stone, 11);
      for (let i = 0; i < 3; i++) tree(c, x + i * 27 - 4, 411, 46, 27, p.leaf, i + x);
    }
    poly(c, [[206,415],[243,415],[345,468],[118,468]], p.ground[2]);
    rect(c, 0, 460, W, 8, p.stone[1]);
  }
  function archive(layers, p, night) {
    let c = layers.fixed;
    // A high clerestory admits the same upper-right sun/moon as the outdoor scenes.
    rect(c, 0, 0, W, 468, night ? "#293943" : "#b8c7bf");
    rect(c, 0, 115, W, 138, night ? "#30434b" : "#c4cdc1");
    for (let x = 0; x < W; x += 112) {
      rect(c, x, 0, 5, 253, p.stone[1]);
      rect(c, x + 4, 0, 2, 253, p.stone[2]);
    }
    rect(c, 260, 24, 156, 110, p.wood[0]);
    rect(c, 265, 28, 147, 102, night ? "#24354e" : "#91b6bd");
    // Celestial disc is drawn later at fixed (366, 64), then mullions over it.
    rect(c, 0, 246, W, 6, p.wood[1]);
    rect(c, 0, 252, W, 3, p.wood[2]);
    c = layers.mid;
    for (const x of [14, 159, 307]) {
      masonry(c, x, 271, 126, 155, p.wood, 30);
      rect(c, x + 6, 277, 114, 141, p.wood[0]);
      for (let row = 0; row < 4; row++) {
        const yy = 283 + row * 33;
        for (let col = 0; col < 4; col++) {
          const xx = x + 10 + col * 27, hh = 17 + Math.floor(hash(row * 13 + col + x) * 10);
          rect(c, xx, yy + 26 - hh, 23, hh, p.stone[(row+col)%2+1]);
          rect(c, xx, yy + 26 - hh, 23, 3, p.wood[2]);
          rect(c, xx + 20, yy + 29 - hh, 3, hh - 3, p.stone[3]);
          rect(c, xx + 5, yy + 33 - hh, 11, 5, p.stone[0]);
          rect(c, xx + 6, yy + 34 - hh, 9, 2, p.stone[2]);
        }
        rect(c, x+4, yy+27, 119, 4, p.wood[1]);
        rect(c, x+4, yy+27, 119, 1, p.wood[3]);
      }
      rect(c, x + 121, 273, 3, 152, p.wood[3]);
    }
    c = layers.near;
    rect(c, 0, 428, W, 40, p.wood[1]);
    // One sorting desk, shallow drawers, paper fan, blotter and brass task lamp.
    masonry(c, 98, 433, 260, 35, p.wood, 17);
    rect(c, 91, 428, 274, 6, p.wood[2]);
    rect(c, 91, 428, 274, 2, p.wood[3]);
    for (let x = 110; x < 350; x += 62) {
      rect(c, x, 441, 48, 19, p.wood[0]);
      rect(c, x+1, 441, 46, 17, p.wood[1]);
      rect(c, x+17, 445, 13, 3, p.steel[2]);
    }
    for (let i = 0; i < 8; i++) rect(c, 132 + i % 3, 427 - i * 2, 45 - i % 4, 2, p.stone[2+i%2]);
    rect(c, 211, 422, 67, 6, p.glass[0]);
    rect(c, 222, 419, 44, 3, p.stone[2]);
    rect(c, 307, 401, 3, 25, p.steel[1]);
    line(c, 308, 402, 294, 392, p.steel[2], 2);
    poly(c, [[284,391],[300,391],[308,399],[276,399]], p.leaf[1]);
    rect(c, 277, 398, 30, 2, p.steel[2]);
    oval(c, 298, 425, 23, 3, p.steel[0]);
  }
  function golf(layers, p, night) {
    let c = layers.far;
    rect(c, 0, 371, W, 97, p.grass[1]);
    for (let x = -40; x < W; x += 69) tree(c, x, 335, 89, 54, p.leaf, x+101);
    c = layers.mid;
    masonry(c, 91, 329, 285, 66, p.pink, 14);
    pitched(c, 84, 307, 299, 22, p.tile);
    for (let x = 101; x < 370; x += 27) arch(c, x, 341, 17, 43, p.pink);
    masonry(c, 267, 277, 48, 110, p.stone, 14);
    rect(c, 263, 270, 56, 8, p.pink[2]);
    pitched(c, 259, 250, 64, 20, p.tile);
    for (let x of [275, 295]) arch(c, x, 287, 12, 25, p.stone);
    for (let x = 276; x < 308; x += 6) rect(c, x, 319, 1, 10, p.stone[0]);
    rect(c, 272, 319, 39, 2, p.stone[2]);
    windowPane(c, 282, 346, 16, 20, p, night, true);
    c = layers.near;
    palm(c, 43, 400, 122, p);
    palm(c, 391, 403, 104, p);
    // Continuous broad ribbons, not alternating mowing stripes.
    oval(c, -95, 403, 422, 118, p.grass[0]);
    oval(c, -82, 407, 372, 86, p.grass[2]);
    oval(c, -35, 412, 267, 45, p.grass[1]);
    oval(c, 300, 405, 196, 59, p.water[0]);
    oval(c, 315, 410, 173, 47, p.water[1]);
    for (let i = 0; i < 5; i++) rect(c, 340+i*9, 419+i*6, 36-i*3, 1, p.water[2]);
    oval(c, 201, 439, 91, 19, p.stone[0]);
    oval(c, 207, 439, 84, 14, p.stone[2]);
    oval(c, 217, 440, 65, 4, p.stone[3]);
    oval(c, 112, 421, 16, 3, p.grass[0]);
    rect(c, 125, 386, 2, 35, p.stone[0]);
    rect(c, 126, 386, 1, 35, p.stone[3]);
    poly(c, [[127,386],[145,389],[127,397]], p.tile[2]);
    poly(c, [[0,456],[71,451],[139,456],[203,468],[0,468]], p.grass[0]);
  }
  function rooftops(layers, p, night) {
    let c = layers.far;
    for (let i = 0; i < 9; i++) {
      const x = i * 59 - 31, y = 280 + Math.floor(hash(i + 66)*73);
      masonry(c, x, y, 48, 432-y, p.brick, 19);
      masonry(c, x+8, y-8, 32, 8, p.brick, 8);
      rect(c, x+23, y-18, 2, 10, p.brick[1]);
      for (let yy = y+12; yy < 420; yy += 20) for (let xx = x+8; xx < x+42; xx += 12) {
        rect(c, xx, yy, 5, 7, p.glass[0]);
        if (night && hash(xx+yy) > .68) rect(c, xx+1, yy+1, 3, 5, "#7f8584");
        else rect(c, xx+3, yy, 2, 7, p.glass[1]);
      }
    }
    c = layers.near;
    masonry(c, -15, 411, 165, 57, p.brick, 10);
    masonry(c, 154, 444, 123, 24, p.brick, 10);
    masonry(c, 280, 425, 179, 43, p.brick, 10);
    for (const [x,y,w] of [[-15,407,165],[154,440,123],[280,421,179]]) {
      rect(c, x, y, w, 4, p.stone[2]);
      rect(c, x, y+4, w, 2, p.stone[0]);
    }
    // Coopered water tank: hoops, lit staves, four legs and crossed supports.
    for (const x of [45, 86]) {
      rect(c, x, 373, 4, 34, p.steel[0]);
      rect(c, x+3, 373, 1, 34, p.steel[2]);
    }
    line(c, 47, 382, 87, 403, p.steel[1], 2);
    line(c, 47, 403, 87, 382, p.steel[1], 2);
    rect(c, 42, 339, 51, 42, p.wood[1]);
    for (let x = 43; x < 92; x += 5) {
      rect(c, x, 340, 1, 40, p.wood[0]);
      rect(c, x+2, 340, 2, 40, p.wood[x > 72 ? 2 : 1]);
    }
    for (let y of [348,372]) { rect(c, 40, y, 55, 3, p.steel[0]); rect(c, 78, y, 17, 1, p.steel[2]); }
    poly(c, [[36,339],[67,326],[99,339]], p.roof[1]);
    poly(c, [[67,326],[99,339],[67,339]], p.roof[2]);
    rect(c, 36, 339, 63, 2, p.roof[3]);
    masonry(c, 310, 390, 74, 31, p.steel, 14);
    for (let y = 396; y < 419; y += 4) rect(c, 320, y, 49, 2, p.steel[0]);
    rect(c, 307, 386, 80, 4, p.steel[2]);
    for (let x of [184,244]) {
      rect(c, x, 417, 17, 23, p.steel[1]);
      rect(c, x-3, 414, 23, 4, p.steel[2]);
      rect(c, x+13, 418, 4, 22, p.steel[3]);
    }
    // Restrained terrace balustrade, grounded rather than a floating sign.
    for (let x = 295; x < 449; x += 16) rect(c, x, 408, 2, 14, p.steel[0]);
    rect(c, 294, 407, 154, 2, p.steel[1]);
  }
  function spaceport(layers, p) {
    let c = layers.far;
    rect(c, 0, 361, W, 107, p.grass[1]);
    rect(c, 0, 363, W, 5, p.water[1]);
    for (let x = -20; x < W; x += 130) {
      masonry(c, x, 349, 96, 32, p.steel, 12);
      oval(c, x+3, 336, 89, 27, p.steel[1]);
      rect(c, x+3, 350, 89, 20, p.steel[1]);
      for (let xx = x+12; xx < x+88; xx += 8) rect(c, xx, 350, 1, 19, p.steel[2]);
    }
    c = layers.mid;
    // Distant service tower with solid footings and open framed bays.
    masonry(c, 232, 393, 119, 12, p.stone, 12);
    rect(c, 243, 245, 6, 149, p.steel[0]);
    rect(c, 279, 245, 7, 149, p.steel[2]);
    for (let y = 249; y < 391; y += 25) {
      rect(c, 241, y, 48, 4, p.steel[1]);
      rect(c, 241, y, 48, 1, p.steel[3]);
      line(c, 249, y+4, 279, y+25, p.steel[1], 2);
      line(c, 279, y+4, 249, y+25, p.steel[0], 2);
    }
    rect(c, 239, 240, 51, 6, p.steel[2]);
    rect(c, 247, 221, 2, 19, p.steel[1]);
    line(c, 248, 224, 318, 246, p.steel[1], 2);
    rect(c, 289, 246, 27, 3, p.steel[2]);
    line(c, 309, 248, 309, 268, p.steel[0]);
    // Original generic launch vehicle; no branding, exhaust, or smoke.
    poly(c, [[309,283],[318,267],[327,283],[330,298],[330,376],[306,376],[306,298]], p.stone[1]);
    poly(c, [[318,269],[326,284],[329,299],[329,374],[322,374],[322,288]], p.stone[2]);
    rect(c, 307, 306, 22, 6, p.steel[0]);
    rect(c, 307, 344, 22, 3, p.steel[0]);
    poly(c, [[306,350],[295,375],[306,375]], p.steel[1]);
    poly(c, [[330,350],[340,375],[330,375]], p.steel[2]);
    rect(c, 309, 376, 6, 8, p.steel[0]);
    rect(c, 322, 376, 6, 8, p.steel[1]);
    rect(c, 295, 384, 48, 9, p.steel[1]);
    for (let y of [288,326,367]) rect(c, 281, y, 25, 3, p.steel[1]);
    c = layers.near;
    masonry(c, 23, 381, 145, 47, p.steel, 12);
    rect(c, 19, 375, 153, 7, p.steel[2]);
    for (let x = 33; x < 159; x += 26) windowPane(c, x, 391, 16, 13, p, false);
    for (let x = 58; x < 152; x += 39) {
      rect(c, x, 363, 28, 12, p.steel[1]);
      for (let yy = 365; yy < 374; yy += 3) rect(c, x+3, yy, 22, 1, p.steel[0]);
    }
    // Low pipework, elbows and distant concrete service road.
    rect(c, 0, 449, W, 19, p.ground[1]);
    rect(c, 0, 447, W, 2, p.ground[2]);
    for (let y of [434,441]) {
      rect(c, 6, y, 182, 4, p.steel[0]);
      rect(c, 6, y, 182, 1, p.steel[2]);
      for (let x = 18; x < 190; x += 39) rect(c, x, y-1, 3, 6, p.steel[1]);
    }
    rect(c, 374, 390, 3, 57, p.steel[1]);
    for (let i = 0; i < 5; i++) rect(c, 377+i*6, 392+i, 6, 10-i, p.stone[i%2+1]);
  }
  function shippingStrait(layers, p, night) {
    let c = layers.far;
    const cliff = night ? ["#4c505d","#5c6068","#6f7175","#83837f"] :
      ["#aaa791","#bab39a","#cac0a2","#d9cdb0"];
    const sea = night ? ["#2e4b5d","#3d5e6c","#527782","#739199"] :
      ["#80aaa9","#93bbb5","#acd0c3","#c6ddd0"];
    const hull = night ? ["#455b68","#576d77","#70858b","#8e9d9d"] :
      ["#879f9b","#9fb1a5","#b8c5b2","#d0d4bc"];
    // Far headlands are air-colored. Each nearer slope has an ochre shaded left
    // facet, pale right-facing scree and long bedding planes, not pixel noise.
    poly(c, [[0,301],[43,291],[74,302],[101,295],[153,328],[190,345],[0,359]], cliff[1]);
    poly(c, [[448,277],[411,286],[389,280],[361,311],[329,318],[289,351],[448,356]], cliff[1]);
    poly(c, [[0,288],[23,270],[39,277],[65,278],[91,299],[116,304],[149,338],[175,351],[0,365]], cliff[0]);
    poly(c, [[23,270],[39,277],[65,278],[91,299],[68,295],[52,304],[40,291]], cliff[2]);
    poly(c, [[91,299],[116,304],[149,338],[133,333],[112,320],[103,322]], cliff[2]);
    poly(c, [[448,263],[419,268],[402,284],[379,289],[362,319],[342,327],[319,354],[448,365]], cliff[0]);
    poly(c, [[419,268],[448,263],[448,355],[418,352],[409,327],[421,302]], cliff[2]);
    poly(c, [[379,289],[402,284],[391,320],[372,338],[356,342],[362,319]], cliff[1]);
    for (const [x,y,w] of [[0,292,42],[8,300,52],[0,311,79],[29,322,67],[12,334,114],
      [0,344,147],[403,297,45],[391,311,42],[382,325,66],[367,337,81],[351,348,97]]) {
      rect(c,x,y,w,1,mix(cliff[0],cliff[2],.55));
      rect(c,x+7,y+2,Math.max(8,w-17),1,mix(cliff[1],cliff[2],.55));
    }
    rect(c,0,359,W,109,sea[1]);
    rect(c,0,359,W,3,sea[2]);
    poly(c,[[0,357],[113,354],[179,361],[150,365],[0,367]],cliff[1]);
    poly(c,[[448,356],[367,352],[319,360],[337,365],[448,363]],cliff[1]);
    c = layers.mid;
    // Shallow calm-water bands, progressively broader toward the quay.
    for (let i=0;i<33;i++) {
      const y=365+Math.floor(hash(i+881)*85),x=Math.floor(hash(i+641)*448);
      rect(c,x,y,9+hash(i+311)*39,1,mix(sea[i%3],sea[1],.55));
    }
    const tanker = (x,y,w,scale) => {
      const s=scale;
      const r=(xx,yy,ww,hh,color)=>rect(c,x+xx*s,y+yy*s,ww*s,hh*s,color);
      poly(c,[[x,y+8*s],[x+w,y+8*s],[x+w-11*s,y+20*s],[x+14*s,y+20*s]],hull[0]);
      poly(c,[[x+5*s,y+10*s],[x+w-2*s,y+10*s],[x+w-10*s,y+15*s],[x+11*s,y+15*s]],hull[1]);
      r(7,7,w/s-12,2,hull[3]);
      r(16,18,w/s-30,2,night?"#6a6268":"#a48f7d");
      // Aft accommodation block, bridge glazing, mast and deck pipe manifold.
      r(19,-9,22,16,hull[2]); r(36,-9,5,16,hull[3]);
      r(17,-12,27,4,hull[1]); r(21,-11,20,1,hull[3]);
      for(let xx=20;xx<40;xx+=5) r(xx,-7,3,3,hull[0]);
      r(25,-19,2,7,hull[1]); r(24,-19,10,1,hull[2]);
      r(46,0,w/s-70,2,hull[2]);
      r(49,4,w/s-68,1,hull[3]);
      for(let xx=53;xx<w/s-23;xx+=16) {
        r(xx,-2,7,8,hull[1]);r(xx+5,-2,2,8,hull[2]);
        r(xx-1,-3,9,1,hull[2]);
      }
      r(w/s-14,-3,1,10,hull[2]);
      rect(c,x+15*s,y+23*s,w-25*s,1,sea[2]);
      rect(c,x+24*s,y+26*s,w-44*s,1,mix(sea[0],sea[1],.6));
    };
    tanker(189,370,111,.60);
    c = layers.near;
    tanker(40,408,165,.85);
    // Far starboard marker and quayside bollards are low, small and grounded.
    rect(c,349,382,3,15,hull[1]);
    rect(c,347,381,7,3,hull[2]);
    rect(c,350,378,2,3,night?"#78938a":"#99b3a0");
    oval(c,343,397,16,2,sea[0]);
    rect(c,0,454,W,14,p.stone[1]);
    rect(c,0,453,W,3,p.stone[3]);
    for(let x=9;x<W;x+=61) {
      rect(c,x,457,37,1,p.stone[0]);
      rect(c,x+17,458,1,9,p.stone[0]);
    }
    for(let x of [22,402]) {
      rect(c,x,446,10,8,hull[0]);
      rect(c,x-2,445,14,3,hull[1]);
      rect(c,x+7,445,5,2,hull[2]);
    }
  }
  function sky(c, theme, id) {
    const night = theme === "night", rooftop = id.includes("penthouse");
    const a = night ? (rooftop ? "#182139" : "#192c45") : (id===STRAIT_ID ? "#9cb9ba" : rooftop ? "#829baf" : "#8eb5bf");
    const b = night ? (id===STRAIT_ID ? "#666e7a" : "#52677a") : (rooftop ? "#d2c5b3" : "#e6dfba");
    for (let y = 0; y < H; y += 4) rect(c, 0, y, W, 4, mix(a, b, Math.min(1, y/435)));
    if (night) for (let i = 0; i < 25; i++) {
      const x = 12 + hash(i+210)*424, y = 15+hash(i+89)*215;
      rect(c, x, y, 1, 1, mix("#8194a4", a, .38));
    }
  }
  function luminary(c, night) {
    const color = night ? "#c2ccd0" : "#eee6ca";
    oval(c, 352, 50, 28, 28, night ? "#8398ab" : "#d4d6bd");
    oval(c, 354, 50, 26, 26, color);
    if (night) {
      oval(c, 357, 58, 7, 5, "#a6b5c1");
      oval(c, 363, 68, 5, 3, "#aebec8");
      rect(c, 377, 58, 2, 9, "#dbe1db");
    }
  }
  function clouds(c, night, offset) {
    const p = night ? ["#455c71", "#526a7d"] : ["#cbd8cc", "#e2e5d2"];
    for (const [cx,y,w] of [[37,101,87],[302,151,74],[140,225,45]]) {
      const x = ((cx - offset + W + 110) % (W+110)) - 55;
      rect(c, x, y+12, w, 5, p[0]);
      rect(c, x+7, y+7, w-19, 6, p[1]);
      rect(c, x+22, y+3, w*.39, 6, p[1]);
      rect(c, x+30, y, w*.17, 4, p[1]);
      rect(c, x-8, y+13, 12, 1, p[0]);
    }
  }
  function createRenderer(assets = {}) {
    const backgrounds = new Map(), obstacleArt = new Map(), lightingArt = new Map();
    const identify = id => {
      const env = E.byId[id];
      if (!env) throw new Error(`Unknown flight environment: ${id}`);
      return env;
    };
    function obstacleLighting(env, theme, top, gap, strength, color) {
      const key = [env.obstacleId, theme, top, gap, strength, color].join("/");
      if (lightingArt.has(key)) return lightingArt.get(key);
      // Use the same three-physical-pixel inset bands as the tuning study.
      const mask = canvas(COLLIDE * 2, FLOOR * 2), mc = mask.getContext("2d");
      mc.fillStyle = "#ffffff";
      for (const b of E.hitboxes(env.obstacleId, 0, top, gap, FLOOR)) mc.fillRect(b.x*2, b.y*2, b.w*2, b.h*2);
      const out = canvas(mask.width, mask.height), oc = out.getContext("2d");
      const band = canvas(mask.width, mask.height), bc = band.getContext("2d");
      for (const lit of [false, true]) {
        bc.clearRect(0, 0, band.width, band.height);
        bc.globalCompositeOperation = "source-over"; bc.drawImage(mask, 0, 0);
        bc.globalCompositeOperation = "destination-out"; bc.drawImage(mask, lit ? -3 : 3, lit ? 3 : -3);
        bc.globalCompositeOperation = "source-in";
        bc.fillStyle = lit ? (theme === "night" ? "#c3dce9" : "#ffedbb") : color;
        bc.fillRect(0, 0, band.width, band.height);
        bc.globalCompositeOperation = "source-over";
        oc.globalAlpha = strength * (lit ? .6 : 1); oc.drawImage(band, 0, 0);
      }
      if (lightingArt.size >= 16) lightingArt.delete(lightingArt.keys().next().value);
      lightingArt.set(key, out);
      return out;
    }
    function getBackground(env, theme) {
      const key = `${env.id}/${theme}`;
      const palaceArt = Object.fromEntries(["far", "mid", "near"].map(name =>
        [name, assets[`palace-${name}-${theme}`]]));
      const available = env.obstacleId === "obst-broken-drum-66" &&
        Object.values(palaceArt).every(image => image && image.complete !== false);
      const stamp = available ? Object.values(palaceArt) : [];
      const old = backgrounds.get(key);
      if (old && old.stamp.length === stamp.length && old.stamp.every((image, i) => image === stamp[i])) {
        backgrounds.delete(key);
        backgrounds.set(key, old);
        return old;
      }
      const planes = {}, layers = {}, p = MATERIALS[theme], night = theme === "night";
      for (const name of ["sky", "fixed", ...Object.keys(PARALLAX)]) {
        planes[name] = canvas();
        layers[name] = planes[name].getContext("2d");
        if (name in PARALLAX) repeatingContexts.add(layers[name]);
      }
      sky(layers.sky, theme, env.id);
      if(env.id===STRAIT_ID) shippingStrait(layers,p,night);
      else switch (env.obstacleId) {
        case "obst-colonnade-66": resort(layers, p, night); break;
        case "obst-broken-drum-66": palace(layers, p, available ? palaceArt : null); break;
        case "obst-elevator-pylon-66": archive(layers, p, night); break;
        case "obst-topiary-pillar-66": golf(layers, p, night); break;
        case "obst-rooftop-stack-66": rooftops(layers, p, night); break;
        case "obst-gantry-tower-66": spaceport(layers, p); break;
      }
      ground(layers.ground, p, env.id);
      const result = { planes, stamp };
      backgrounds.delete(key);
      backgrounds.set(key, result);
      // Retain outgoing/incoming scenes in both themes without keeping the whole campaign in memory.
      if (backgrounds.size > MAX_BACKGROUND_PAIRS) backgrounds.delete(backgrounds.keys().next().value);
      return result;
    }
    function getObstacle(env, theme) {
      const id = env.obstacleId, maritime = env.id===STRAIT_ID, key = env.id + theme;
      if (obstacleArt.has(key)) return obstacleArt.get(key);
      const sw = SHAFT[id], ch = CAP_H[id], p = HAZARDS[maritime ? "maritime-beacon" : id][theme];
      const shaft = canvas(sw, FLOOR), c = shaft.getContext("2d");
      for (let x = 0; x < sw; x++) {
        const t = x / (sw - 1), k = t * 4;
        rect(c, x, 0, 1, FLOOR, mix(p[Math.floor(k)], p[Math.min(5, Math.floor(k)+1)], k % 1));
      }
      if (maritime) {
        // Salt-worn painted beacon tower. Broad terracotta bands, inset service
        // hatches and a narrow ladder distinguish this from the launch gantry.
        for(let y=0;y<FLOOR;y+=57) {
          for(let x=1;x<sw-1;x++)
            rect(c,x,y+24,1,14,mix(p[0],p[6],.38+x/sw*.62));
          rect(c,8,y+7,24,12,p[1]);
          rect(c,9,y+7,22,10,p[3]);
          rect(c,11,y+9,17,1,p[4]);
          rect(c,26,y+12,3,2,p[0]);
          rect(c,2,y+41,sw-4,1,p[1]);
          rect(c,7,y+42,sw-9,1,p[4]);
          for(let i=0;i<5;i++) {
            const xx=8+hash(y+i)*29,yy=y+46+hash(y+i+14)*9;
            rect(c,xx,yy,2,1,p[2]);
          }
        }
        rect(c,36,0,2,FLOOR,p[1]);
        rect(c,46,0,2,FLOOR,p[4]);
        for(let y=4;y<FLOOR;y+=9) {
          rect(c,37,y+1,10,1,p[1]);
          rect(c,37,y,10,1,p[4]);
        }
      } else if (id === "obst-colonnade-66" || id === "obst-broken-drum-66") {
        for (let x = 5; x < sw - 4; x += 7) {
          const k = x / sw;
          rect(c, x, 0, 2, FLOOR, mix(p[0], p[3], k));
          rect(c, x+2, 0, 1, FLOOR, mix(p[2], p[5], k*.72));
          rect(c, x+3, 0, 1, FLOOR, mix(p[1], p[4], k));
        }
        for (let y = 33; y < FLOOR; y += 51) {
          rect(c, 1, y, sw-2, 1, p[1]);
          rect(c, 6, y+1, sw-7, 1, p[4]);
          const x = 11 + Math.floor(hash(y)*26);
          line(c, x, y+14, x+5, y+19, p[2]);
          line(c, x+5, y+19, x+3, y+26, p[2]);
        }
      } else if (id === "obst-elevator-pylon-66") {
        for (let y = 0, row = 0; y < FLOOR; row++) {
          const hh = [27,18,23,32][row%4];
          rect(c, 2, y, sw-4, hh-2, p[row%3 === 0 ? 2 : 3]);
          rect(c, 2, y, 7, hh-2, p[1]);
          rect(c, sw-8, y, 6, hh-2, p[4]);
          rect(c, 1, y+hh-2, sw-2, 2, p[0]);
          if (row % 3 === 0) {
            rect(c, 3, y+2, sw-6, 3, p[4]);
            rect(c, 18, y+9, 20, 9, p[1]);
            rect(c, 19, y+10, 18, 6, p[4]);
            rect(c, 22, y+12, 10, 1, p[2]);
          } else {
            for (let yy = y+4; yy < y+hh-2; yy += 3) rect(c, 9, yy, sw-17, 1, p[2]);
            rect(c, 18+row%2*14, y, 2, hh-2, p[6]);
          }
          y += hh;
        }
      } else if (id === "obst-topiary-pillar-66") {
        for (let y = 0; y < FLOOR; y += 5) for (let x = 2; x < sw-3; x += 5) {
          const n = hash(x*3+y), k = x < 16 ? 1 : x < 38 ? 2 : 3;
          rect(c, x+(n>.5?1:0), y, 4, 3, p[k]);
          rect(c, x+2, y, 2, 1, p[k+1]);
          if (n>.63) rect(c, x, y+3, 3, 2, p[Math.max(0,k-1)]);
        }
        for (let y = 17; y < FLOOR; y += 37) {
          line(c, 17, y, 25, y+14, p[1]);
          line(c, 25, y+14, 23, y+23, p[1]);
          rect(c, 25, y+11, 5, 2, p[3]);
        }
      } else if (id === "obst-rooftop-stack-66") {
        for (let y = 0; y < FLOOR; y += 13) {
          rect(c, 2, y+12, sw-4, 1, p[1]);
          for (let x = 4+(y%26?9:0); x < sw-5; x += 18) rect(c, x, y+1, 1, 11, p[1]);
          if (y%78 === 0) {
            rect(c, 11, y+3, 32, 32, p[0]);
            for (let yy = y+5; yy < y+34; yy += 4) {
              rect(c, 13, yy, 28, 2, p[2]);
              rect(c, 30, yy, 11, 1, p[4]);
            }
          }
        }
        rect(c, 5, 0, 3, FLOOR, p[6]);
        rect(c, sw-8, 0, 3, FLOOR, p[4]);
      } else {
        rect(c, 8, 0, sw-16, FLOOR, p[1]);
        for (let y = 0; y < FLOOR; y += 31) {
          line(c, 10, y+3, sw-11, y+29, p[2], 3);
          line(c, sw-11, y+3, 10, y+29, p[3], 2);
          rect(c, 4, y, sw-8, 4, p[2]);
          rect(c, 5, y, sw-10, 1, p[4]);
          for (const x of [5,sw-7]) rect(c, x, y+1, 2, 2, p[5]);
        }
        rect(c, 5, 0, 3, FLOOR, p[0]);
        rect(c, sw-8, 0, 3, FLOOR, p[4]);
        for (let y = 16; y < FLOOR; y += 67) rect(c, 17, y, 16, 5, p[6]);
      }
      rect(c, 0, 0, 1, FLOOR, p[0]);
      rect(c, sw-2, 0, 1, FLOOR, p[4]);
      rect(c, sw-1, 0, 1, FLOOR, p[5]);
      const caps = [false,true].map(lower => {
        const out = canvas(COLLIDE, ch), cc = out.getContext("2d");
        rect(cc, 0, 0, COLLIDE, ch, p[2]);
        for (let x = 0; x < COLLIDE; x++) rect(cc, x, 0, 1, ch, mix(p[1], p[4], x/(COLLIDE-1)));
        rect(cc, 0, 0, COLLIDE, 3, p[4]);
        rect(cc, 0, ch-4, COLLIDE, 3, p[1]);
        if (maritime) {
          rect(cc,3,4,60,7,p[0]);
          const signal = lower ? (theme==="night"?"#9fbb9f":"#91ad8c") :
            (theme==="night"?"#bf9b91":"#bb8d76");
          for(let x=7;x<61;x+=9) {
            rect(cc,x,5,6,5,mix(p[1],signal,.55+x/140));
            rect(cc,x+4,5,2,5,signal);
            rect(cc,x,5,6,1,p[4]);
          }
          rect(cc,3,12,60,2,p[6]);
          rect(cc,6,2,54,1,p[5]);
        } else if (id.includes("colonnade") || id.includes("broken-drum")) {
          rect(cc, 2, 5, 62, 2, p[5]);
          rect(cc, 3, 8, 60, 6, p[3]);
          for (let x = 8; x < 60; x += 7) {
            rect(cc, x, 9, 2, 5, p[1]);
            rect(cc, x+2, 9, 3, 2, p[5]);
            rect(cc, x-1, 11, 4, 1, p[4]);
          }
          if (id.includes("colonnade")) rect(cc, 2, ch-5, 62, 2, p[6]);
        } else if (id.includes("elevator")) {
          for (let y = 4; y < ch-3; y += 3) rect(cc, 4, y, 58, 1, p[1]);
          rect(cc, 3, 0, 60, 4, p[6]);
          rect(cc, 12, 1, 16, 2, p[4]);
          rect(cc, 48, 4, 2, ch-7, p[6]);
        } else if (id.includes("topiary")) {
          if (lower) {
            rect(cc, 2, 4, 62, 10, p[6]);
            for (let x = 8; x < 60; x += 9) {
              rect(cc, x, 6, 2, 6, p[1]);
              rect(cc, x+2, 6, 2, 6, p[4]);
            }
          } else for (let x = 3; x < 63; x += 5) for (let y = 4; y < ch-4; y += 4)
            rect(cc, x, y, 3, 2, p[x<30?2:4]);
        } else {
          rect(cc, 3, 5, 60, ch-10, p[0]);
          for (let x = 6; x < 61; x += 6) {
            rect(cc, x, 6, 2, ch-12, p[3]);
            rect(cc, x+1, 6, 1, ch-12, p[4]);
          }
          rect(cc, 2, ch-5, 62, 2, p[6]);
        }
        rect(cc, 0, 0, 1, ch, p[0]);
        rect(cc, 64, 0, 2, ch, p[5]);
        // Lit upper surface; shadowed underside. At night the underside retains a
        // narrow cool reflected edge, not a second source on the left.
        rect(cc, 1, lower ? 0 : ch-1, 64, 1, lower ? p[5] : theme === "night" ? p[3] : p[0]);
        return out;
      });
      const art = { shaft, caps };
      obstacleArt.set(key, art);
      return art;
    }
    return {
      drawBackground(ctx, { envId, theme = "day", time = 0, scroll = 0, reduced = false } = {}) {
        const env = identify(envId), mode = theme === "night" ? "night" : "day";
        safe(ctx, () => {
          const { planes } = getBackground(env, mode);
          ctx.drawImage(planes.sky, 0, 0);
          ctx.drawImage(planes.fixed, 0, 0);
          if (env.obstacleId !== "obst-elevator-pylon-66")
            clouds(ctx, mode === "night", reduced ? 0 : (scroll * .018 + time * .7) % (W+110));
          luminary(ctx, mode === "night");
          if (env.obstacleId === "obst-elevator-pylon-66") {
            const p = MATERIALS[mode];
            ctx.save();
            ctx.beginPath(); ctx.rect(265,28,147,102); ctx.clip();
            const drift = reduced ? 0 : (scroll*.012+time*.4)%170;
            rect(ctx, 318-drift, 113, 39, 2, p.glass[1]);
            rect(ctx, 327-drift, 111, 21, 2, p.glass[1]);
            ctx.restore();
            rect(ctx, 311, 28, 3, 102, p.wood[1]);
            rect(ctx, 361, 28, 3, 102, p.wood[1]);
            rect(ctx, 265, 103, 147, 3, p.wood[1]);
            rect(ctx, 257, 131, 163, 4, p.wood[2]);
          }
          for (const [name, speed] of Object.entries(PARALLAX)) {
            const offset = reduced ? 0 : modulo(Math.floor(scroll * speed), W);
            ctx.drawImage(planes[name], -offset, 0);
            if (offset) ctx.drawImage(planes[name], W - offset, 0);
          }
        });
      },
      drawObstacle(ctx, { envId, theme = "day", x, top, gap, shadowStrength = .30,
        shadowColor = theme === "night" ? "#0b1424" : "#27333b" }) {
        if (!Number.isFinite(shadowStrength) || shadowStrength < 0 || shadowStrength > 1 ||
            !/^#[0-9a-f]{6}$/i.test(shadowColor)) throw new Error("Invalid obstacle shadow settings");
        const env = identify(envId), mode = theme === "night" ? "night" : "day";
        const art = getObstacle(env, mode), boxes = E.hitboxes(env.obstacleId, x, top, gap, FLOOR);
        safe(ctx, () => {
          // A ground-plane shadow only: never paste a translucent shaft into sky.
          const strength = shadowStrength;
          ctx.save();
          ctx.beginPath(); ctx.rect(0, FLOOR+8, W, H-FLOOR-8); ctx.clip();
          ctx.globalAlpha = strength;
          poly(ctx, [[x+5,FLOOR+8],[x+61,FLOOR+8],[x+11,FLOOR+28],[x-71,FLOOR+28]], shadowColor);
          ctx.restore();
          for (const box of boxes) {
            const cap = box.part.endsWith("cap");
            const image = cap ? art.caps[box.part.startsWith("floor") ? 1 : 0] : art.shaft;
            ctx.drawImage(image, 0, 0, image.width, box.h, box.x, box.y, box.w, box.h);
          }
          if (strength > 0) ctx.drawImage(obstacleLighting(env, mode, top, gap, strength, shadowColor),
            x, 0, COLLIDE, FLOOR);
        });
      },
      drawForeground(ctx, { envId, theme = "day", time = 0, scroll = 0, reduced = false } = {}) {
        const env = identify(envId), mode = theme === "night" ? "night" : "day", p = MATERIALS[mode];
        safe(ctx, () => {
          // Thin foreground accents stay below the collision floor and therefore
          // cannot mask the actual lower cap or its gap-facing edge.
          if (["obst-topiary-pillar-66","obst-broken-drum-66","obst-colonnade-66"].includes(env.obstacleId)) {
            const phase = reduced ? 0 : modulo(Math.floor(scroll), 94);
            for (let x = -phase-20; x < W; x += 94) {
              const sway = reduced ? 0 : Math.round(Math.sin(time*.6+x)*1);
              line(ctx, x+4, 510, x+sway, 500, p.leaf[0]);
              line(ctx, x+4, 508, x+10+sway, 498, p.leaf[1]);
              rect(ctx, x+10+sway, 498, 3, 2, p.leaf[2]);
            }
          }
        });
      }
    };
  }
  window.TRUMPET_PIXEL_SCENERY = Object.freeze({ createRenderer });
})();
