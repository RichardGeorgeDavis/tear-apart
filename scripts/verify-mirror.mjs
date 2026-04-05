import path from "node:path";
import { chromium } from "playwright";
import { startStaticServer } from "./server-utils.mjs";

const rootDir = path.resolve(process.cwd(), "mirror");
const screenshotPath = path.join(rootDir, ".verify.png");

const server = await startStaticServer({ rootDir, host: "127.0.0.1", port: 0, quiet: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const missing = new Set();

page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.origin === server.url && response.status() >= 400) {
    missing.add(url.pathname);
  }
});

page.on("requestfailed", (request) => {
  const url = new URL(request.url());
  if (url.origin === server.url && request.failure()?.errorText !== "net::ERR_ABORTED") {
    missing.add(url.pathname);
  }
});

await page.goto(server.url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12000);
await page.mouse.move(720, 450);
await page.mouse.move(980, 520, { steps: 24 });
await page.waitForTimeout(2000);
await page.screenshot({ path: screenshotPath });

await browser.close();
await server.close();

if (missing.size) {
  console.error("Missing local files:");
  for (const filePath of [...missing].sort()) {
    console.error(`- ${filePath}`);
  }
  process.exitCode = 1;
} else {
  console.log("Mirror verified with no missing same-origin requests.");
}
