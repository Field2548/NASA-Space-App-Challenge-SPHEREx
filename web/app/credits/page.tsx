import { readFile } from "node:fs/promises";
import path from "node:path";
import CreditsPage from "@/components/CreditsPage";

// CREDITS.md sits at the repo root, one level above web/ (next runs from web/). Read at build time;
// if the deploy root is web/ only, the file is absent and the page links to GitHub instead.
async function readCredits(): Promise<string | null> {
  "use cache";
  try {
    return await readFile(path.join(process.cwd(), "..", "CREDITS.md"), "utf8");
  } catch {
    return null;
  }
}

export default async function Page() {
  return <CreditsPage markdown={await readCredits()} />;
}
