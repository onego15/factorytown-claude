// Quick screenshot helper: node scripts/shot.mjs <out.png> [jsToEvalBefore] [waitMs]
import { chromium } from 'playwright';
const [, , out = 'artifacts/shot.png', js = '', wait = '4000'] = process.argv;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(process.env.URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
if (js) {
  const r = await page.evaluate(js);
  if (r !== undefined) console.log('eval:', JSON.stringify(r));
}
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(logs.slice(-30).join('\n'));
await browser.close();
