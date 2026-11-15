// Regenerates web/public/leaderboard-snapshot.json: the BOT row only, no invented players.
// The bot row carries `movers` (known objects it reaches) for the Movers found board.
// Run from web/:  node scripts/make-leaderboard-snapshot.mjs
// Loads lib/server/bot.ts through Vite (a dependency of vitest), so no extra tooling is needed.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({
  root,
  logLevel: "error",
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { "@": root } },
});
try {
  const { botScore, mergeBot } = await vite.ssrLoadModule("/lib/server/bot.ts");
  const bot = await botScore(undefined, root);
  const snapshot = {
    scope: "all",
    slug: null,
    source: "snapshot",
    updated_at: new Date().toISOString(),
    rows: mergeBot([], bot).rows.map((r) => (r.is_bot ? { ...r, movers: bot.matched } : r)),
  };
  const file = path.join(root, "public", "leaderboard-snapshot.json");
  await writeFile(file, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote ${file}\nbot score ${bot.score}, accuracy ${bot.accuracy}`);
} finally {
  await vite.close();
}
