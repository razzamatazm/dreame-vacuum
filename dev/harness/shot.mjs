#!/usr/bin/env node
/*
 * Render a card page against the mock hass, run optional steps, screenshot it,
 * and fail on console errors / page errors.
 *
 *   node dev/harness/shot.mjs <page> [--params '{"x":1}'] [--config '{}'] [--w 480] [--vw px --h px (viewport)] [--touch 1]
 *        [--fixture name1,name2] [--click "css >> selector"]... [--eval "js"]... [--out /tmp/doc-shots/x.png]
 *
 * Steps run in the order given. Playwright CSS selectors pierce open shadow roots.
 * Prints recorded callService calls as JSON. Needs Playwright in /tmp/doc-harness.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("/tmp/doc-harness/node_modules/playwright/index.mjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const page = args[0] && !args[0].startsWith("--") ? args.shift() : "home";
const opt = { params: "{}", config: "{}", w: "480", out: `/tmp/doc-shots/${page}.png` };
const steps = [];
for (let i = 0; i < args.length; i += 2) {
  const k = args[i].replace(/^--/, "");
  if (k === "click" || k === "eval" || k === "wait") steps.push([k, args[i + 1]]);
  else opt[k] = args[i + 1];
}

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(opt.vw || Number(opt.w) + 24), height: Number(opt.h || 900) }, deviceScaleFactor: 1, hasTouch: !!opt.touch });
const pg = await ctx.newPage();
const errors = [];
pg.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  else if (process.env.VERBOSE) console.log(`[${m.type()}]`, m.text());
});
pg.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const q = new URLSearchParams({ page, params: opt.params, config: opt.config, w: opt.w, fixture: opt.fixture || "" });
await pg.goto(`http://127.0.0.1:${port}/dev/harness/index.html?${q}`);
await pg.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
await pg.waitForTimeout(600);
for (const [kind, val] of steps) {
  try {
    if (kind === "click") await pg.locator(val).first().click({ timeout: 4000 });
    else if (kind === "eval") await pg.evaluate(val);
    else if (kind === "wait") await pg.waitForTimeout(Number(val));
    await pg.waitForTimeout(350);
  } catch (e) {
    errors.push(`step ${kind} ${val}: ${e.message.split("\n")[0]}`);
  }
}
fs.mkdirSync(path.dirname(opt.out), { recursive: true });
await pg.screenshot({ path: opt.out, fullPage: true });
const calls = await pg.evaluate(() => window.__calls || []);
await browser.close();
server.close();

console.log(JSON.stringify({ page, screenshot: opt.out, calls, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
