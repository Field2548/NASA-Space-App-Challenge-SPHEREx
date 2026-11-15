import { readFile } from "node:fs/promises";
import path from "node:path";
import CreditsPage from "@/components/CreditsPage";

// The copy in web/content/ is made by scripts/copy-credits.mjs (prebuild and predev) and committed,
// so it exists on Vercel when the project root is web/. The repo-root file is the fallback for local runs.
// If neither exists, the page shows a short message with a GitHub link instead.
async function readCredits(): Promise<string | null> {
  "use cache";
  for (const file of [path.join(process.cwd(), "content", "CREDITS.md"), path.join(process.cwd(), "..", "CREDITS.md")]) {
    try {
      return await readFile(/*turbopackIgnore: true*/ file, "utf8");
    } catch {
      // try the next location
    }
  }
  return null;
}

export default async function Page() {
  return <CreditsPage markdown={await readCredits()} />;
}
