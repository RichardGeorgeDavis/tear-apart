import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startStaticServer } from "./server-utils.mjs";

const targetUrl = new URL(process.env.TARGET_URL ?? "https://tearapart.activetheory.dev/");
const targetOrigin = targetUrl.origin;
const outputDir = path.resolve(process.cwd(), "public");
const manifestPath = path.join(outputDir, ".clone-manifest.json");
const SETTINGS_STYLE = `
<style id="codex-settings-style">
  :root {
    --codex-settings-bg: rgba(7, 10, 14, 0.76);
    --codex-settings-border: rgba(255, 255, 255, 0.12);
    --codex-settings-text: rgba(255, 255, 255, 0.92);
    --codex-settings-muted: rgba(255, 255, 255, 0.64);
    --codex-settings-accent: #6bb6ff;
  }

  #codex-settings-root {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--codex-settings-text);
  }

  #codex-settings-toggle,
  #codex-settings-panel {
    pointer-events: auto;
  }

  #codex-settings-toggle {
    position: absolute;
    top: 16px;
    right: 16px;
    border: 1px solid var(--codex-settings-border);
    background: var(--codex-settings-bg);
    color: var(--codex-settings-text);
    border-radius: 999px;
    padding: 10px 14px;
    cursor: pointer;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  #codex-settings-panel {
    position: absolute;
    top: 64px;
    right: 16px;
    width: min(320px, calc(100vw - 32px));
    padding: 16px;
    border: 1px solid var(--codex-settings-border);
    background: var(--codex-settings-bg);
    color: var(--codex-settings-text);
    border-radius: 18px;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  }

  #codex-settings-panel[hidden] {
    display: none;
  }

  #codex-settings-panel h2 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
  }

  #codex-settings-panel p {
    margin: 0 0 14px;
    color: var(--codex-settings-muted);
  }

  .codex-settings-row {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }

  .codex-settings-row label {
    color: var(--codex-settings-muted);
    font-size: 12px;
    letter-spacing: 0.02em;
  }

  .codex-settings-row select,
  .codex-settings-row input,
  .codex-settings-row button {
    width: 100%;
    border: 1px solid var(--codex-settings-border);
    background: rgba(255, 255, 255, 0.06);
    color: var(--codex-settings-text);
    border-radius: 12px;
    padding: 10px 12px;
    cursor: pointer;
  }

  .codex-settings-inline {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  .codex-settings-inline input[type="range"] {
    padding: 0;
  }

  .codex-settings-inline span {
    min-width: 3.5em;
    text-align: right;
    color: var(--codex-settings-muted);
    font-size: 12px;
  }

  .codex-settings-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  #codex-settings-panel button[data-active="true"] {
    border-color: rgba(107, 182, 255, 0.48);
    color: #dff0ff;
    background: rgba(107, 182, 255, 0.14);
  }

  #Stage {
    filter: contrast(var(--codex-stage-contrast, 1)) saturate(var(--codex-stage-saturate, 1)) brightness(var(--codex-stage-brightness, 1));
  }

  body.codex-high-contrast {
    --codex-stage-contrast: 1.12;
    --codex-stage-saturate: 1.1;
  }

  @media (max-width: 640px) {
    #codex-settings-toggle {
      top: auto;
      right: 12px;
      bottom: 12px;
    }

    #codex-settings-panel {
      top: auto;
      right: 12px;
      bottom: 64px;
      left: 12px;
      width: auto;
    }
  }
</style>`;
const SETTINGS_MARKUP = `
<div id="codex-settings-root" aria-live="polite">
  <button id="codex-settings-toggle" type="button" aria-haspopup="dialog" aria-expanded="false">
    Settings
  </button>
  <section id="codex-settings-panel" hidden aria-label="Settings menu">
    <h2>Settings</h2>
    <p>Local controls for the cloned scene. Press Space to pause or resume.</p>
    <div class="codex-settings-row">
      <label for="codex-render-scale">Render scale</label>
      <select id="codex-render-scale">
        <option value="1">Full</option>
        <option value="0.75">Balanced</option>
        <option value="0.5">Performance</option>
      </select>
    </div>
    <div class="codex-settings-row">
      <label>Visuals</label>
      <button id="codex-toggle-contrast" type="button" data-active="false">Enable contrast boost</button>
    </div>
    <div class="codex-settings-row">
      <label for="codex-glow-intensity">Glow intensity</label>
      <div class="codex-settings-inline">
        <input id="codex-glow-intensity" type="range" min="0.85" max="1.3" step="0.05" value="1" />
        <span id="codex-glow-value">100%</span>
      </div>
    </div>
    <div class="codex-settings-actions">
      <button id="codex-reset" type="button">Reset</button>
      <button id="codex-fullscreen" type="button">Fullscreen</button>
      <button id="codex-reload" type="button">Reload</button>
    </div>
  </section>
</div>`;
const SETTINGS_SCRIPT = `
<script id="codex-settings-script">
(() => {
  const STORAGE_KEY = "codex-tear-apart-settings";
  const state = {
    open: false,
    paused: false,
    contrast: false,
    renderScale: 1,
    glowIntensity: 1
  };

  const els = {};
  const defaults = {
    paused: false,
    contrast: false,
    renderScale: 1,
    glowIntensity: 1
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (typeof saved.paused === "boolean") state.paused = saved.paused;
      if (typeof saved.contrast === "boolean") state.contrast = saved.contrast;
      if ([1, 0.75, 0.5].includes(Number(saved.renderScale))) state.renderScale = Number(saved.renderScale);
      if (Number.isFinite(Number(saved.glowIntensity))) {
        const glowIntensity = Number(saved.glowIntensity);
        if (glowIntensity >= 0.85 && glowIntensity <= 1.3) state.glowIntensity = glowIntensity;
      }
    } catch {}
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      paused: state.paused,
      contrast: state.contrast,
      renderScale: state.renderScale,
      glowIntensity: state.glowIntensity
    }));
  }

  function applyRenderScale() {
    const renderer = window.World && window.World.RENDERER;
    const stage = window.Stage;
    if (!renderer || !stage) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * state.renderScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(stage.width, stage.height);
  }

  function applyPaused() {
    if (!window.Render) return;
    if (state.paused) {
      window.Render.pause();
    } else {
      window.Render.resume();
    }
  }

  function applyContrast() {
    document.body.classList.toggle("codex-high-contrast", state.contrast);
  }

  function applyGlowIntensity() {
    const contrastBoost = state.contrast ? 1.06 : 1;
    const brightness = Math.round(state.glowIntensity * contrastBoost * 1000) / 1000;
    document.documentElement.style.setProperty("--codex-stage-brightness", String(brightness));
  }

  function syncButtons() {
    if (!els.panel) return;
    els.panel.hidden = !state.open;
    els.toggle.setAttribute("aria-expanded", String(state.open));
    els.scale.value = String(state.renderScale);
    els.contrast.dataset.active = String(state.contrast);
    els.contrast.textContent = state.contrast ? "Disable contrast boost" : "Enable contrast boost";
    els.glow.value = String(state.glowIntensity);
    els.glowValue.textContent = Math.round(state.glowIntensity * 100) + "%";
  }

  async function applyAll() {
    applyRenderScale();
    applyPaused();
    applyContrast();
    applyGlowIntensity();
    syncButtons();
    saveState();
  }

  function resetState() {
    state.paused = defaults.paused;
    state.contrast = defaults.contrast;
    state.renderScale = defaults.renderScale;
    state.glowIntensity = defaults.glowIntensity;
    localStorage.removeItem(STORAGE_KEY);
  }

  function bind() {
    els.toggle = document.getElementById("codex-settings-toggle");
    els.panel = document.getElementById("codex-settings-panel");
    els.scale = document.getElementById("codex-render-scale");
    els.contrast = document.getElementById("codex-toggle-contrast");
    els.glow = document.getElementById("codex-glow-intensity");
    els.glowValue = document.getElementById("codex-glow-value");
    els.reset = document.getElementById("codex-reset");
    els.fullscreen = document.getElementById("codex-fullscreen");
    els.reload = document.getElementById("codex-reload");

    els.toggle.addEventListener("click", () => {
      state.open = !state.open;
      syncButtons();
    });

    els.scale.addEventListener("change", (event) => {
      state.renderScale = Number(event.target.value);
      applyAll();
    });

    els.contrast.addEventListener("click", () => {
      state.contrast = !state.contrast;
      applyAll();
    });

    els.glow.addEventListener("input", (event) => {
      state.glowIntensity = Number(event.target.value);
      applyAll();
    });

    els.reset.addEventListener("click", async () => {
      resetState();
      await applyAll();
    });

    els.reload.addEventListener("click", () => {
      window.location.reload();
    });

    els.fullscreen.addEventListener("click", async () => {
      const target = document.documentElement;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    });

    window.addEventListener("keydown", (event) => {
      const tagName = document.activeElement && document.activeElement.tagName;
      const isEditingField = tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA";

      if (event.code === "Space" && !isEditingField) {
        event.preventDefault();
        state.paused = !state.paused;
        applyAll();
        return;
      }

      if (event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        state.open = !state.open;
        syncButtons();
      }
      if (event.key === "Escape" && state.open) {
        state.open = false;
        syncButtons();
      }
    });

    window.addEventListener("resize", applyRenderScale);

    const waitForRuntime = window.setInterval(() => {
      if (window.World && window.World.RENDERER && window.Stage) {
        window.clearInterval(waitForRuntime);
        applyAll();
      }
    }, 250);

    window.setTimeout(() => {
      window.clearInterval(waitForRuntime);
      syncButtons();
      applyContrast();
      applyGlowIntensity();
    }, 10000);

    syncButtons();
    applyContrast();
    applyGlowIntensity();
  }

  loadState();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();
</script>`;

function toLocalPath(urlString) {
  const url = new URL(urlString);
  if (url.origin !== targetOrigin) {
    throw new Error(`Refusing to mirror cross-origin URL: ${urlString}`);
  }

  const cleanPath = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  return path.join(outputDir, cleanPath.replace(/^\/+/, ""));
}

function sanitizeHtml(html) {
  return html
    .replace(/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]+"><\/script>\s*/g, "")
    .replace(/<script>function gtag\(\)\{dataLayer\.push\(arguments\)\}[\s\S]*?<\/script>\s*/g, "")
    .replace("</head>", `${SETTINGS_STYLE}\n</head>`)
    .replace("<body>", `<body>\n${SETTINGS_MARKUP}\n`)
    .replace("</body>", `${SETTINGS_SCRIPT}\n</body>`);
}

function sanitizeJavaScript(js) {
  return js.replace(
    "if(UnsupportedRedirect.requiresWebGL=!0,UnsupportedRedirect.unsupported())return void window.location.replace(window._UNSUPPORTED_PAGE_);",
    "UnsupportedRedirect.requiresWebGL=!0;"
  );
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function download(remoteUrl) {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${remoteUrl}: ${response.status} ${response.statusText}`);
  }

  const destination = toLocalPath(remoteUrl);
  await ensureParent(destination);
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/html")) {
    const html = sanitizeHtml(await response.text());
    await fs.writeFile(destination, html);
  } else if (contentType.includes("javascript") || destination.endsWith(".js")) {
    const js = sanitizeJavaScript(await response.text());
    await fs.writeFile(destination, js);
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destination, buffer);
  }

  return destination;
}

async function captureRuntimeUrls(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const captured = new Set([baseUrl]);

  page.on("requestfinished", (request) => {
    const url = request.url();
    if (url.startsWith(targetOrigin)) {
      captured.add(url.split("#")[0]);
    }
  });

  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(targetOrigin) && response.status() < 400) {
      captured.add(url.split("#")[0]);
    }
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);
  await page.mouse.move(720, 450);
  await page.mouse.move(980, 520, { steps: 24 });
  await page.waitForTimeout(4000);
  await browser.close();

  return [...captured].sort();
}

async function collectMissingLocalPaths(serverUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const missing = new Set();

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === serverUrl && response.status() >= 400) {
      missing.add(url.pathname);
    }
  });

  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin === serverUrl && request.failure()?.errorText !== "net::ERR_ABORTED") {
      missing.add(url.pathname);
    }
  });

  await page.goto(serverUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);
  await page.mouse.move(720, 450);
  await page.mouse.move(980, 520, { steps: 24 });
  await page.waitForTimeout(4000);
  await browser.close();

  return [...missing].sort();
}

async function writeManifest(data) {
  await ensureParent(manifestPath);
  await fs.writeFile(manifestPath, `${JSON.stringify(data, null, 2)}\n`);
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

console.log(`Capturing runtime requests from ${targetUrl.href}`);
const requestedUrls = await captureRuntimeUrls(targetUrl.href);

console.log(`Downloading ${requestedUrls.length} same-origin files`);
for (const remoteUrl of requestedUrls) {
  await download(remoteUrl);
}

const server = await startStaticServer({ rootDir: outputDir, host: "127.0.0.1", port: 0, quiet: true });
let finalMissingLocalPaths = [];

try {
  const seenMissingPaths = new Set();

  for (let pass = 1; pass <= 5; pass += 1) {
    const missingLocalPaths = await collectMissingLocalPaths(server.url);
    finalMissingLocalPaths = missingLocalPaths;

    if (!missingLocalPaths.length) {
      break;
    }

    const newMissingLocalPaths = missingLocalPaths.filter((pathname) => !seenMissingPaths.has(pathname));
    if (!newMissingLocalPaths.length) {
      break;
    }

    console.log(`Found ${newMissingLocalPaths.length} missing local files after pass ${pass}`);
    for (const pathname of newMissingLocalPaths) {
      seenMissingPaths.add(pathname);
      const remoteUrl = new URL(pathname, targetOrigin).href;
      await download(remoteUrl);
    }
  }
} finally {
  await server.close();
}

await writeManifest({
  source: targetUrl.href,
  clonedAt: new Date().toISOString(),
  requestCount: requestedUrls.length,
  localValidationMissing: finalMissingLocalPaths
});

if (finalMissingLocalPaths.length) {
  console.warn("Public runtime still has missing local files:");
  for (const pathname of finalMissingLocalPaths) {
    console.warn(`- ${pathname}`);
  }
}

console.log(`Clone complete. Files saved to ${outputDir}`);
