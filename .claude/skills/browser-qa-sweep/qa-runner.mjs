// qa-runner.mjs — drive ONE deployed web app in a real browser, screenshot core
// surfaces, capture console/page errors. Run once per base URL (viewer :8081,
// grafana :3000, ...), editing SURFACES for that app.
//
// Run from a dir where "playwright" resolves (e.g. the odelia-viewer repo root):
//   QA_USER=viewer QA_PASS=viewer node .claude/skills/browser-qa-sweep/qa-runner.mjs
// Env: QA_BASE_URL (default http://localhost:8081), QA_USER, QA_PASS, QA_OUT (default ./qa-out)
// Opt: QA_STUDY_UID (adds a viewer-study surface), QA_VIEWER_PATH (route prefix; default /viewer/template?StudyInstanceUIDs=)
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

if (process.env.QA_STUDY_UID) SURFACES.push({ name: "04-viewer-study", path: (process.env.QA_VIEWER_PATH || "/viewer/template?StudyInstanceUIDs=") + process.env.QA_STUDY_UID, act: async (p) => { await p.waitForTimeout(6000); } });
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

async function ensureAppLoaded(page) {
  // Resolve any Keycloak/login interstitial, then wait until the APP itself is rendered
  // so screenshots capture the app, not a login/redirect page. The session persists in
  // this single browser context, so after the first login this normally just waits out
  // the SSO redirect (no re-login). Only fills the form if one actually appears.
  for (let i = 0; i < 4; i++) {
    if (await page.locator("#username").count()) { await maybeLogin(page); continue; }
    if (!/\/realms\/|\/auth\/|openid-connect/.test(page.url())) break;
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
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
    await ensureAppLoaded(page);  // wait for app render; don't screenshot a login interstitial
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
