import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const sourceDir = path.resolve(cwd, "public");
const distDir = path.resolve(cwd, "dist");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(sourceDir, "index.html")))) {
  console.error("Missing public/index.html. Run `npm run clone` first.");
  process.exit(1);
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

await fs.cp(sourceDir, distDir, {
  recursive: true,
  filter(source) {
    const base = path.basename(source);
    if (base === ".DS_Store") return false;
    if (base === ".clone-manifest.json") return false;
    if (base === ".verify.png") return false;
    return true;
  }
});

console.log(`Built static clone to ${distDir}`);
