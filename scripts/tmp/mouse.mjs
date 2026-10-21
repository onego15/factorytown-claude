import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('ERR ' + e.message));
await page.goto('http://127.0.0.1:5173/'); await page.waitForTimeout(2500);
await page.click('#t-new'); await page.waitForTimeout(1500);
const ts = (x, y) => page.evaluate(([x, y]) => __gv.tileToScreen(x, y), [x, y]);
// select lumber via hotkey 1 is speed... click build button
await page.click('.tool[data-b="lumber"]');
const spot = await page.evaluate(() => __gv.dev.findSpot(game.world, 'lumber', __gv.dev.hallCenter(game.world), { minEff: 0.9 }));
console.log('spot', JSON.stringify(spot));
await page.evaluate((s) => { const w = game.world; game.scene.rig.goal.set(s.x + 2 - w.W / 2, 0.5, s.y + 2 - w.H / 2); }, spot);
await page.waitForTimeout(3000);
let p = await ts(spot.x, spot.y); await page.mouse.move(p.x, p.y); await page.waitForTimeout(800);
await page.screenshot({ path: 'artifacts/m1.png' });
await page.mouse.click(p.x, p.y); await page.waitForTimeout(500); console.log('after click', await page.evaluate(() => [...game.world.entities.values()].map(e => e.type).join(',')), await page.evaluate(() => document.getElementById('toasts').innerText));
// belt
await page.keyboard.press('b');
let a = await ts(spot.x + 2, spot.y), b = await ts(spot.x + 2, spot.y + 4);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x+b.x)/2, (a.y+b.y)/2, { steps: 5 }); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/m2.png' });
await page.mouse.up(); await page.waitForTimeout(500);
console.log(await page.evaluate(() => { const w = game.world; return [...w.entities.values()].filter(e => e.type !== 'road' && e.type !== 'house').map(e => `${e.type}@${e.x},${e.y} d${e.dir}`).join(' | ') + ' coins ' + w.coins; }));
await page.keyboard.press('Escape');
await page.waitForTimeout(3000);
const l = await ts(spot.x, spot.y); await page.mouse.click(l.x, l.y); await page.waitForTimeout(800);
await page.screenshot({ path: 'artifacts/m3.png' });
console.log(logs.join('\n'));
await browser.close();
