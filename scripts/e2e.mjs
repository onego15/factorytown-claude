// End-to-end browser test: plays the real game through mouse and keyboard input in headless Chromium.
// Usage: npm run e2e   (starts its own Vite dev server unless URL is set)
// Covers: new game, building placement with the mouse, belt dragging, production and stock changes,
// research and upgrade through the UI, save, page reload and resume.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'artifacts/e2e';
mkdirSync(OUT, { recursive: true });
let server = null;
let url = process.env.URL;
if (!url) {
  server = spawn('npx', ['vite', '--port', '5181', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        res();
      }
    });
  });
  url = 'http://127.0.0.1:5181/';
}

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const tileXY = (x, y) => ev(([x, y]) => window.__gv.tileToScreen(x, y), [x, y]);
const focus = async (x, y, dist = 16) => {
  await ev(([x, y, d]) => {
    const g = window.game, w = g.world;
    g.scene.rig.goal.set(x + 0.5 - w.W / 2, 0.5, y + 0.5 - w.H / 2);
    g.scene.rig.distGoal = d;
  }, [x, y, dist]);
  await wait(2500); // let the camera settle
};
const state = () =>
  ev(() => {
    const w = window.game.world;
    const ents = [...w.entities.values()];
    return {
      coins: Math.round(w.coins),
      n: ents.length,
      types: ents.map((e) => e.type).sort().join(','),
      log: w.stock('log'),
      plank: w.stock('plank'),
      onBelts: ents.reduce((s, e) => s + (e.items ? e.items.length : 0), 0),
      research: [...w.research].sort().join(','),
      lumberLevel: ents.find((e) => e.type === 'lumber')?.level ?? 0,
      time: w.time,
    };
  });

try {
  // ---------------------------------------------------------------- title → new game
  await page.goto(url, { waitUntil: 'load' });
  await wait(2500);
  check('title screen is shown', await page.isVisible('#title'));
  await page.screenshot({ path: `${OUT}/01-title.png` });
  await page.click('#t-new');
  await wait(1500);
  check('new game starts', !(await page.isVisible('#title')));
  const s0 = await state();

  // ---------------------------------------------------------------- place a lumber camp with the mouse
  await page.click('.tool[data-b="lumber"]');
  const spot = await ev(() => window.__gv.dev.findSpot(window.game.world, 'lumber', window.__gv.dev.hallCenter(window.game.world), { minEff: 0.9 }));
  await focus(spot.x + 1, spot.y + 1);
  // the 2×2 footprint is anchored on the hovered tile
  let p = await tileXY(spot.x, spot.y);
  await page.mouse.move(p.x, p.y);
  await wait(400);
  check('placement tooltip shows efficiency', /効率/.test(await page.innerText('#tip')), (await page.innerText('#tip')).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${OUT}/02-ghost.png` });
  await page.mouse.click(p.x, p.y);
  await wait(400);
  const s1 = await state();
  check('lumber camp placed by clicking', s1.types.includes('lumber'), `${s0.n} → ${s1.n} entities`);
  check('construction cost is paid', s1.coins === s0.coins - 25, `${s0.coins} → ${s1.coins}`);

  // invalid placement: try to put a sawmill on top of the hall
  await page.click('.tool[data-b="lumber"]');
  const hc = await ev(() => window.__gv.dev.hallCenter(window.game.world));
  await focus(hc.x, hc.y);
  p = await tileXY(hc.x, hc.y);
  await page.mouse.move(p.x, p.y);
  await wait(400);
  const badTip = await page.innerText('#tip');
  check('blocked placement explains why', /重な|木がありません/.test(badTip), badTip.replace(/\s+/g, ' '));
  await page.mouse.click(p.x, p.y);
  await wait(300);
  check('blocked placement does not build', (await state()).n === s1.n);
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------- drag belts from the camp to the hall
  const camp = await ev(() => [...window.game.world.entities.values()].find((e) => e.type === 'lumber').id);
  const path = await ev((id) => {
    const dry = [];
    window.__gv.dev.route(window.game.world, id, window.game.world.hallId, { dry });
    return dry;
  }, camp);
  check('a belt path to the hall exists', path.length > 0, `${path.length} tiles`);
  // split into straight runs and drag each one with the belt tool (keyboard shortcut B)
  await page.keyboard.press('b');
  const runs = [];
  let start = 0;
  for (let i = 1; i <= path.length; i++) if (i === path.length || path[i].dir !== path[start].dir) {
    runs.push([path[start], path[Math.min(i, path.length - 1)], path[start].dir, i - start]);
    start = i;
  }
  for (const [a, b, dir, len] of runs) {
    // a run ends on the first tile of the next run (its corner), which the next drag re-lays
    const end = len === 1 && a === b ? a : b;
    await focus(Math.round((a.x + end.x) / 2), Math.round((a.y + end.y) / 2), 18);
    const pa = await tileXY(a.x, a.y), pb = await tileXY(end.x, end.y);
    if (a.x === end.x && a.y === end.y) {
      // single tile: rotate with R until it faces the right way, then click
      for (let r = 0; r < 4; r++) {
        const rot = await ev(() => window.game.input.rot);
        if (rot === dir) break;
        await page.keyboard.press('r');
      }
      await page.mouse.click(pa.x, pa.y);
    } else {
      await page.mouse.move(pa.x, pa.y);
      await page.mouse.down();
      await page.mouse.move((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { steps: 6 });
      await page.mouse.move(pb.x, pb.y, { steps: 6 });
      await wait(200);
      await page.mouse.up();
    }
    await wait(250);
  }
  // the last tile must face into the hall
  const last = path[path.length - 1];
  const lastDir = await ev(([x, y]) => window.game.world.entAt(x, y)?.dir, [last.x, last.y]);
  if (lastDir !== last.dir) {
    for (let r = 0; r < 4; r++) {
      const rot = await ev(() => window.game.input.rot);
      if (rot === last.dir) break;
      await page.keyboard.press('r');
    }
    const pl = await tileXY(last.x, last.y);
    await page.mouse.click(pl.x, pl.y);
  }
  await page.screenshot({ path: `${OUT}/03-belts.png` });
  const s2 = await state();
  const beltsOk = await ev((pth) => pth.every((t) => {
    const e = window.game.world.entAt(t.x, t.y);
    return e && e.type === 'belt' && e.dir === t.dir;
  }), path);
  check('dragged belts follow the planned path', beltsOk, `${s2.n - s1.n} belts placed`);
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------- production in real time
  await page.click('#speed [data-speed="3"]');
  const logBefore = (await state()).log;
  await focus(spot.x + 1, spot.y + 1, 14);
  await wait(9000);
  const s3 = await state();
  check('items travel on the belts', s3.onBelts > 0, `${s3.onBelts} items on belts`);
  await page.screenshot({ path: `${OUT}/04-production.png` });
  await wait(12000);
  const s4 = await state();
  check('hall log stock rises from the line', s4.log > logBefore, `${logBefore} → ${s4.log} (game time ${s3.time.toFixed(0)}s → ${s4.time.toFixed(0)}s)`);
  const chip = await page.innerText('#stock');
  check('HUD stock chip shows the hall stock', chip.includes(String(s4.log)) || chip.includes(String(s4.log - 1)) || chip.includes(String(s4.log + 1)), chip.replace(/\s+/g, ' '));

  // ---------------------------------------------------------------- research through the UI
  // the early game would need a sawmill first; give the materials directly (test shortcut)
  await ev(() => {
    const h = window.game.world.entities.get(window.game.world.hallId);
    h.inv.plank = 60;
    h.inv.stone = 40;
    window.game.world.coins += 400;
  });
  await page.click('#btn-research');
  await wait(500);
  await page.click('[data-r="stonework"]');
  await wait(300);
  await page.screenshot({ path: `${OUT}/05-research.png` });
  check('research starts from the research tree', (await ev(() => window.game.world.activeResearch)) === 'stonework');
  // skip ahead: run the simulation for 25 game seconds
  await ev(() => { for (let i = 0; i < 250; i++) window.game.world.tick(); });
  await page.click('#r-x');
  await wait(300);
  await page.click('#btn-research');
  await wait(300);
  await page.click('[data-r="improve1"]');
  await ev(() => { for (let i = 0; i < 350; i++) window.game.world.tick(); });
  await page.click('#r-x');
  const s5 = await state();
  check('research completes and unlocks improvements', s5.research.includes('improve1') && s5.research.includes('stonework'), s5.research);

  // ---------------------------------------------------------------- select the camp and upgrade it from the inspector
  await page.click('[data-mode="select"]');
  await focus(spot.x + 1, spot.y + 1, 14);
  p = await tileXY(spot.x, spot.y);
  await page.mouse.click(p.x, p.y);
  await wait(600);
  check('clicking a building opens the inspector', await page.isVisible('#inspector'));
  const before = await state();
  await page.click('#i-up');
  await wait(500);
  const s6 = await state();
  await page.screenshot({ path: `${OUT}/06-upgraded.png` });
  check('upgrade raises the level', s6.lumberLevel === 2, `level ${before.lumberLevel} → ${s6.lumberLevel}`);
  check('upgrade costs coins', s6.coins < before.coins, `${before.coins} → ${s6.coins}`);

  // ---------------------------------------------------------------- save, reload, resume
  await page.click('#btn-menu');
  await wait(300);
  await page.click('#mm-save');
  await wait(300);
  check('save shows a confirmation', /保存/.test(await page.innerText('#toasts')));
  await page.click('#mm-x');
  await page.click('#speed [data-speed="0"]');
  const saved = await state();
  await page.reload({ waitUntil: 'load' });
  await wait(2500);
  check('continue button offered after reload', await page.isVisible('#t-continue'));
  await page.click('#t-continue');
  await wait(1500);
  const s7 = await state();
  check('resumed world has the same buildings', s7.types === saved.types, `${saved.n} → ${s7.n} entities`);
  check('resumed world keeps research and upgrades', s7.research === saved.research && s7.lumberLevel === 2);
  check('resumed world keeps stock', s7.log >= saved.log - 2 && s7.plank === saved.plank, `log ${saved.log} → ${s7.log}`);
  await wait(6000);
  const s8 = await state();
  check('simulation keeps running after resume', s8.time > s7.time && s8.onBelts > 0, `t ${s7.time.toFixed(1)} → ${s8.time.toFixed(1)}`);
  await page.screenshot({ path: `${OUT}/07-resumed.png` });
} catch (e) {
  check('test ran to completion', false, e.message.split('\n')[0]);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
await browser.close();
if (server) process.kill(-server.pid);
process.exit(failed ? 1 : 0);
