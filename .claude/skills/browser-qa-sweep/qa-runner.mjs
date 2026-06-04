// qa-runner.mjs — drive ONE deployed web app in a real browser, screenshot core
// surfaces, capture console/page errors. Run once per base URL (viewer :8081,
// grafana :3000, ...), editing SURFACES for that app.
//
// Run from a dir where "playwright" resolves (e.g. the odelia-viewer repo root):
//   QA_USER=viewer QA_PASS=viewer node .claude/skills/browser-qa-sweep/qa-runner.mjs
// Env: QA_BASE_URL (default http://localhost:8081), QA_USER, QA_PASS, QA_OUT (default ./qa-out)
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.QA_BASE_URL || "http://localhost:8081";
const USER = process.env.QA_USER || "viewer";
const PASS = process.env.QA_PASS || "viewer";
const OUT = process.env.QA_OUT || "./qa-out";

// --- Surfaces to sweep. Edit per app/regression. ---
// name: file stem | path: route under BASE | act: optional async (page) => {}
const SURFACES = [
  { name: "01-studylist", path: "/" },
  { name: "02-studylist-search", path: "/", act: async (p) => {
      const s = p.locator("input[type=text], input[type=search]").first();
      if (await s.count()) { await s.fill("zzz-no-match"); await p.waitForTimeout(1500); }
    } },
  { name: "03-invalid-study", path: "/viewer?StudyInstanceUIDs=1.2.3.invalid" },
];

async function maybeLogin(page) {
  // Keycloak login form appears after redirect. Submit, then wait until redirected
  // back out of the realm (i.e. actually logged into the app).
  try {
    const u = page.locator("#username");
    if (await u.count()) {
      await u.fill(USER);
      await page.locator("#password").fill(PASS);
      await page.locator("#kc-login, input[type=submit], button[type=submit]").first().click();
      await page.waitForURL((url) => !String(url).includes("/realms/"), { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    }
  } catch {}
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const results = [];
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForSelector("#username", { timeout: 8000 }).catch(() => {});
// Capture the auth/login page itself BEFORE authenticating (a broken login is invisible otherwise).
if (await page.locator("#username").count()) {
  const shot = path.join(OUT, "00-login.png");
  await page.screenshot({ path: shot, fullPage: true });
  results.push({ name: "00-login", url: page.url(), screenshot: shot, consoleErrors: [], ok: true });
}
await maybeLogin(page);
await page.waitForTimeout(1500); // let app shell settle post-login

for (const s of SURFACES) {
  const at = errors.length;
  try {
    await page.goto(BASE + s.path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await maybeLogin(page);
    if (s.act) await s.act(page);
    await page.waitForTimeout(2000);
    const shot = path.join(OUT, s.name + ".png");
    await page.screenshot({ path: shot, fullPage: true });
    results.push({ name: s.name, url: page.url(), screenshot: shot, consoleErrors: errors.slice(at), ok: true });
  } catch (e) {
    results.push({ name: s.name, error: String(e), consoleErrors: errors.slice(at), ok: false });
  }
}
await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
await browser.close();
console.log("QA sweep done:", results.length, "surfaces ->", OUT);
