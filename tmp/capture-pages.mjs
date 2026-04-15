import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'C:/Users/regan/Downloads/afrospice';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.join(ROOT, 'tmp', 'page-captures', RUN_ID);
const USER_DIR = path.join(ROOT, 'tmp', 'chrome-capture-profile', RUN_ID);
const DEBUG_PORT = 9222;
const FRONTEND = 'http://localhost:5173';
const BACKEND = 'https://afrospice-backend.onrender.com';

const chromePathCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}
async function getChromePath() {
  for (const candidate of chromePathCandidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error('No Chrome/Edge executable found');
}
class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.loadWaiters = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Page.loadEventFired') {
        const waiters = [...this.loadWaiters];
        this.loadWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    });
  }
  async init() {
    await this.ready;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitForLoad(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.loadWaiters = this.loadWaiters.filter((fn) => fn !== onLoad);
        reject(new Error('Timed out waiting for load event'));
      }, timeoutMs);
      const onLoad = () => { clearTimeout(timer); resolve(); };
      this.loadWaiters.push(onLoad);
    });
  }
  async navigate(url) {
    const waiter = this.waitForLoad();
    await this.send('Page.navigate', { url });
    await waiter;
    await wait(1800);
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return result?.result?.value;
  }
  async screenshot(filePath) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
    await fs.writeFile(filePath, Buffer.from(result.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch {} }
}
async function login() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId: 'ADMIN001', pin: '1234' }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const json = await res.json();
  const token = json?.data?.token;
  const user = json?.data?.user;
  if (!token || !user) throw new Error('Login response missing token/user');
  return { token, user };
}
async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.rm(USER_DIR, { recursive: true, force: true });
  await fs.mkdir(USER_DIR, { recursive: true });
  const chromePath = await getChromePath();
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,'--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${USER_DIR}`,'--window-size=1600,1400','about:blank',
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  chrome.unref();
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const pageTarget = targets.find((target) => target.type === 'page');
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('No page target from Chrome DevTools');
  const page = new CdpPage(pageTarget.webSocketDebuggerUrl);
  await page.init();
  const { token, user } = await login();
  await page.navigate(`${FRONTEND}/login`);
  await page.evaluate(`localStorage.setItem('afrospice_token', ${JSON.stringify(token)}); localStorage.setItem('afrospice_user', JSON.stringify(${JSON.stringify(user)})); true;`);
  const routes = [
    { name: 'dashboard', url: `${FRONTEND}/` },
    { name: 'inventory', url: `${FRONTEND}/pos-dashboard` },
    { name: 'terminal', url: `${FRONTEND}/terminal` },
    { name: 'orders', url: `${FRONTEND}/orders` },
    { name: 'reports', url: `${FRONTEND}/reports` },
    { name: 'customers', url: `${FRONTEND}/customers` },
    { name: 'suppliers', url: `${FRONTEND}/suppliers` },
    { name: 'users', url: `${FRONTEND}/users` },
  ];
  const report = [];
  for (const route of routes) {
    await page.navigate(route.url);
    const title = await page.evaluate('document.querySelector(".page-title")?.textContent?.trim() || document.title');
    const hero = await page.evaluate('document.querySelector(".hero-panel, .dashboard-command-hero, .customers-command-hero, .suppliers-command-hero")?.getBoundingClientRect().width || 0');
    const screenshotPath = path.join(OUT_DIR, `${route.name}.png`);
    await page.screenshot(screenshotPath);
    report.push({ route: route.name, title, heroWidth: hero, screenshotPath });
  }
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  page.close();
  console.log(JSON.stringify({ outDir: OUT_DIR, report }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
