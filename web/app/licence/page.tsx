import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import BackLink from "@/components/BackLink";
import styles from "@/components/InfoPage.module.css";

export const metadata: Metadata = { title: "Licence" };

const REPO_URL = "https://github.com/Field2548/NASA-Space-App-Challenge-SPHEREx/tree/web";
const GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.txt";

// The full GPL text: web/content/LICENSE.txt (copied at build time, committed), then the repo-root LICENSE.
// If neither can be read, the page links to the FSF copy instead.
async function readLicence(): Promise<string | null> {
  "use cache";
  for (const file of [path.join(process.cwd(), "content", "LICENSE.txt"), path.join(process.cwd(), "..", "LICENSE")]) {
    try {
      return await readFile(/*turbopackIgnore: true*/ file, "utf8");
    } catch {
      // try the next location
    }
  }
  return null;
}

export default async function LicencePage() {
  const text = await readLicence();
  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Licence</h1>
      <p>
        This site&apos;s code is free software under the GNU General Public License, version 3. It includes Aladin Lite
        (GPL-3.0) by CDS. You can get the complete source code at{" "}
        <a href={REPO_URL} rel="noreferrer">
          the project repository
        </a>
        .
      </p>
      {text ? (
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.5 }}>{text}</pre>
      ) : (
        <p>
          The full licence text could not be loaded here. Read it at{" "}
          <a href={GPL_URL} rel="noreferrer">
            gnu.org
          </a>
          .
        </p>
      )}
    </main>
  );
}
