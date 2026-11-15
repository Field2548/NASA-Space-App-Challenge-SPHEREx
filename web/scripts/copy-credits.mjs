// Copies the repo-root CREDITS.md and LICENSE into web/content/ so the credits and licence pages
// work when Vercel's project root is web/ (the parent folder is then not in the build).
// Runs as prebuild and predev. Exits 1 only when a source is missing and no copy exists yet.

import { copyFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(webRoot, "content");

const files = [
  { src: path.join(webRoot, "..", "CREDITS.md"), dest: path.join(contentDir, "CREDITS.md") },
  { src: path.join(webRoot, "..", "LICENSE"), dest: path.join(contentDir, "LICENSE.txt") },
];

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

let failed = false;
await mkdir(contentDir, { recursive: true });

for (const { src, dest } of files) {
  const name = path.relative(webRoot, dest);
  if (await exists(src)) {
    await copyFile(src, dest);
    console.log(`copied ${path.relative(webRoot, src)} -> ${name}`);
  } else if (await exists(dest)) {
    console.warn(`WARNING: ${path.relative(webRoot, src)} not found; keeping existing copy ${name}`);
  } else {
    console.error(`ERROR: ${path.relative(webRoot, src)} not found and no copy at ${name}`);
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
