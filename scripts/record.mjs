// Records docs/demo.gif from a real play session in headless Chromium.
// The first part is driven by real mouse/keyboard events (placing a lumber camp, dragging belts);
// the time-lapse part lets the built-in scripted player (src/dev/bot.ts, same rules, no cheats)
// keep building while the simulation is fast-forwarded. Frames are stepped manually so the
// GIF plays at a steady speed even though software WebGL renders slowly.
// Usage: node scripts/record.mjs   (needs a dev server on URL, default http://127.0.0.1:5173/)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const FPS = 10;
const DIR = 'artifacts/frames';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync('docs', { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(process.env.URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

// manual frame stepping, a visible cursor (headless screenshots have none) and a caption
await page.evaluate(() => {
  window.game.manual = true;
  const c = document.createElement('div');
  c.id = 'rec-cursor';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.2 19.2 L10.2 12.8 L16.2 12.6 Z" fill="#fff" stroke="#2b2622" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))';
  document.body.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  const cap = document.createElement('div');
  cap.id = 'rec-cap';
  cap.style.cssText = 'position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:9998;pointer-events:none;background:rgba(43,38,34,.78);color:#fff8ea;font:700 15px/1.2 "M PLUS Rounded 1c",system-ui,sans-serif;padding:7px 14px;border-radius:999px;display:none;letter-spacing:.04em';
  document.body.appendChild(cap);
});

let frame = 0;
let mouse = { x: 640, y: 360 };
const shot = async () => {
  await page.screenshot({ path: `${DIR}/f${String(frame++).padStart(4, '0')}.png` });
};
const step = async (n = 1, fn) => {
  for (let i = 0; i < n; i++) {
    if (fn) await fn(i, n);
    await page.evaluate((dt) => window.game.step(dt), 1 / FPS);
    await shot();
  }
};
const moveTo = async (x, y, frames = 8) => {
  const a = { ...mouse };
  await step(frames, async (i, n) => {
    const t = (i + 1) / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    mouse = { x: a.x + (x - a.x) * e, y: a.y + (y - a.y) * e };
    await page.mouse.move(mouse.x, mouse.y);
  });
};
const caption = (text) => page.evaluate((t) => {
  const c = document.getElementById('rec-cap');
  c.textContent = t;
  c.style.display = t ? 'block' : 'none';
}, text);
const center = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const tile = (x, y) => page.evaluate(([x, y]) => window.__gv.tileToScreen(x, y), [x, y]);
const camera = (x, y, dist, yaw, pitch) => page.evaluate(([x, y, d, yaw, pitch]) => {
  const g = window.game, w = g.world, r = g.scene.rig;
  r.goal.set(x + 0.5 - w.W / 2, 0.5, y + 0.5 - w.H / 2);
  if (d) r.distGoal = d;
  if (yaw !== undefined && yaw !== null) r.yawGoal = yaw;
  if (pitch) r.pitchGoal = pitch;
}, [x, y, dist, yaw, pitch]);

// ---------------------------------------------------------------- title
await step(14);
let p = await center('#t-new');
await moveTo(p.x, p.y, 10);
await page.mouse.click(p.x, p.y);
await step(4);

// ---------------------------------------------------------------- place a lumber camp
const hc = await page.evaluate(() => window.__gv.dev.hallCenter(window.game.world));
const spot = await page.evaluate((hc) => window.__gv.dev.findSpot(window.game.world, 'lumber', hc, { minEff: 0.9 }), hc);
await caption('マウスで伐採小屋を建てる');
await camera(spot.x + 1, spot.y + 1, 15, null, 0.92);
await step(16);
p = await center('.tool[data-b="lumber"]');
await moveTo(p.x, p.y, 8);
await page.mouse.click(p.x, p.y);
await step(2);
p = await tile(spot.x, spot.y);
await moveTo(p.x, p.y, 10);
await step(8);
await page.mouse.click(p.x, p.y);
await step(8);

// ---------------------------------------------------------------- drag belts to the town hall
await caption('ベルトをドラッグして町役場へつなぐ');
const camp = await page.evaluate(() => [...window.game.world.entities.values()].find((e) => e.type === 'lumber').id);
const path = await page.evaluate((id) => {
  const dry = [];
  window.__gv.dev.route(window.game.world, id, window.game.world.hallId, { dry });
  return dry;
}, camp);
// frame the whole path inside the area not covered by the HUD
const safe = (q) => q.x > 300 && q.x < 1220 && q.y > 130 && q.y < 520;
const cx = path.reduce((a, t) => a + t.x, 0) / path.length, cy = path.reduce((a, t) => a + t.y, 0) / path.length;
const saved = await page.evaluate(() => { const r = window.game.scene.rig; return { t: r.target.toArray(), g: r.goal.toArray(), d: r.dist, dg: r.distGoal }; });
let fit = 40;
for (let d = 14; d <= 40; d += 2) {
  // probe without recording: snap the camera, measure, then restore it
  await page.evaluate(([x, y, d]) => {
    const g = window.game, w = g.world, r = g.scene.rig;
    r.goal.set(x + 0.5 - w.W / 2, 0.5, y + 0.5 - w.H / 2);
    r.target.copy(r.goal);
    r.dist = r.distGoal = d;
    r.pitch = r.pitchGoal = 0.92;
    g.scene.frame(0, 1, false, 0);
  }, [cx, cy, d]);
  let ok = true;
  for (const t of path) if (!safe(await tile(t.x, t.y))) ok = false;
  if (ok) {
    fit = d;
    break;
  }
}
await page.evaluate((s) => { const r = window.game.scene.rig; r.target.fromArray(s.t); r.goal.fromArray(s.g); r.dist = s.d; r.distGoal = s.dg; window.game.scene.frame(0, 1, false, 0); }, saved);
await camera(cx, cy, fit, null, 0.92);
await step(16);
await page.keyboard.press('b');
const runs = [];
let st = 0;
for (let i = 1; i <= path.length; i++)
  if (i === path.length || path[i].dir !== path[st].dir) {
    runs.push([path[st], path[Math.min(i, path.length - 1)]]);
    st = i;
  }
for (const [a, b] of runs) {
  if (a.x === b.x && a.y === b.y) continue;
  const pa = await tile(a.x, a.y), pb = await tile(b.x, b.y);
  await moveTo(pa.x, pa.y, 6);
  await page.mouse.down();
  const n = Math.max(6, Math.round(Math.hypot(pb.x - pa.x, pb.y - pa.y) / 14));
  await moveTo(pb.x, pb.y, n);
  await step(3);
  await page.mouse.up();
  await step(3);
}
const last = path[path.length - 1];
const lastDir = await page.evaluate(([x, y]) => window.game.world.entAt(x, y)?.dir, [last.x, last.y]);
if (lastDir !== last.dir) {
  for (let r = 0; r < 4 && (await page.evaluate(() => window.game.input.rot)) !== last.dir; r++) await page.keyboard.press('r');
  const pl = await tile(last.x, last.y);
  await moveTo(pl.x, pl.y, 5);
  await page.mouse.click(pl.x, pl.y);
}
await page.keyboard.press('Escape');
await step(4);

// ---------------------------------------------------------------- watch the goods flow
await caption('丸太がベルトで運ばれ、町役場の在庫が増える');
p = await center('#speed [data-speed="3"]');
await moveTo(p.x, p.y, 8);
await page.mouse.click(p.x, p.y);
const mid = path[Math.floor(path.length / 2)];
await camera(mid.x, mid.y, 9, null, 0.62);
await moveTo(1180, 640, 6);
await step(46);

// ---------------------------------------------------------------- time-lapse with the scripted player
await caption('早送り：自動プレイで街が育つ（同じルール・チートなし）');
await page.evaluate(() => {
  const g = window.game;
  window.__bot = window.__gv.createBot(g.world);
  g.setSpeed(1);
});
await camera(hc.x, hc.y + 2, 26, null, 0.85);
const lapse = 84;
await step(lapse, async (i) => {
  await page.evaluate(([i, n]) => {
    const g = window.game, w = g.world;
    for (let k = 0; k < 330; k++) {
      w.tick();
      window.__gv.updateQuests(w);
      window.__bot.afterTick();
    }
    g.scene.dayTime = (0.15 + (i / n) * 1.0) % 1; // one full day over the time-lapse
    g.scene.rig.yawGoal += 0.016;
    g.scene.rig.distGoal = 26 + (i / n) * 12;
  }, [i, lapse]);
});

// ---------------------------------------------------------------- finale: evening close-up and the stats panel
await caption('');
await page.evaluate(() => { window.game.scene.dayTime = 0.6; });
await camera(hc.x, hc.y, 15, null, 0.7);
await step(30, async () => page.evaluate(() => { window.game.scene.rig.yawGoal += 0.01; }));
p = await center('#btn-stats');
await moveTo(p.x, p.y, 8);
await page.mouse.click(p.x, p.y);
await step(22);
const summary = await page.evaluate(() => {
  const w = window.game.world;
  return { pop: w.pop, milestone: w.milestone, gameMinutes: +(w.time / 60).toFixed(1), entities: w.entities.size, timeline: window.__bot.timeline.filter((l) => !l.includes('upgrade')) };
});
console.log(JSON.stringify(summary, null, 1));
await browser.close();

// ---------------------------------------------------------------- encode
console.log(`${frame} frames`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${DIR}/f%04d.png`, '-vf', 'scale=720:-1:flags=lanczos,palettegen=max_colors=112:stats_mode=diff', `${DIR}/palette.png`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${DIR}/f%04d.png`, '-i', `${DIR}/palette.png`, '-lavfi', 'scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle', 'docs/demo.gif']);
console.log('wrote docs/demo.gif');
