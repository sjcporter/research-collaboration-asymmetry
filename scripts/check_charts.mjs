// Headless render of each page; capture console errors + count SVG elements.
// Run with: node scripts/check_charts.mjs            (against local dev server)
//      or:  URL=https://… node scripts/check_charts.mjs   (against live)

import {chromium} from "playwright";

const URL = process.env.URL ?? "http://127.0.0.1:3000";
const PAGES = ["/", "/partners", "/country", "/field", "/type"];

const browser = await chromium.launch();
let bad = 0;

for (const path of PAGES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  console.log(`\n=== ${URL}${path} ===`);
  await page.goto(`${URL}${path}`, {waitUntil: "networkidle", timeout: 60000});
  await page.waitForTimeout(3500);

  const figures = await page.$$eval("figure, svg", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      rects: el.querySelectorAll("rect").length,
      circles: el.querySelectorAll("circle").length,
      paths: el.querySelectorAll("path").length,
      text: el.querySelectorAll("text").length,
      h: el.clientHeight
    })).filter(f => f.h > 30) // drop tiny legend swatches
  );
  console.log(`  charts: ${figures.length}`);
  figures.forEach((f, i) => console.log(`    [${i}] ${f.tag} h=${f.h} rect=${f.rects} circle=${f.circles} path=${f.paths} text=${f.text}`));

  if (errors.length) {
    bad++;
    console.log(`  ERRORS (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => console.log(`    ${e}`));
  }

  await ctx.close();
}

await browser.close();
process.exit(bad ? 1 : 0);
