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

// Wording copied from CREDITS.md ("Required acknowledgments"). Always shown, even without the file.
function DataAcknowledgments() {
  return (
    <section aria-labelledby="data-acknowledgments">
      <h2 id="data-acknowledgments">Data acknowledgments</h2>
      <p>
        This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of
        Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the
        California Institute of Technology, and is funded by the National Aeronautics and Space Administration.
      </p>
      <p>
        This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics
        and Space Administration and operated by the California Institute of Technology.
      </p>
      <p>Sky map background: SPHEREx QR2 HiPS, CDS, Strasbourg (ODbL). Sky viewer: Aladin Lite (CDS, GPL-3.0).</p>
    </section>
  );
}

export default async function Page() {
  return <CreditsPage markdown={await readCredits()} intro={<DataAcknowledgments />} />;
}
