// @vitest-environment jsdom
import { render, cleanup, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import AboutPage from "./AboutPage";
import CreditsPage, { CREDITS_URL, parseMarkdown } from "./CreditsPage";
import { ABOUT_SECTIONS } from "@/lib/copy/about";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

afterEach(cleanup);

describe("Back control on the info pages", () => {
  it("About and Credits both show a Back link to /", () => {
    render(<AboutPage />);
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
    cleanup();
    render(<CreditsPage markdown={null} />);
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
  });
});

const SAMPLE = `# Credits

<!-- hidden -->

Intro with **bold**, \`code\`, [a link](https://x.org/a) and https://y.org/path.

## Table

| Name | Link |
| --- | --- |
| Gaia | https://gea.esac.esa.int/ |
| Pipe \\| cell | [LICENSE](LICENSE) |

> quoted *text*

- one
- two

# Second h1
`;

describe("parseMarkdown", () => {
  it("parses headings, paragraphs, tables, quotes and lists; drops comments", () => {
    const b = parseMarkdown(SAMPLE);
    expect(b.map((x) => x.kind)).toEqual(["heading", "paragraph", "heading", "table", "quote", "list", "heading"]);
    const t = b[3];
    if (t.kind !== "table") throw new Error("table");
    expect(t.head).toEqual(["Name", "Link"]);
    expect(t.rows).toEqual([
      ["Gaia", "https://gea.esac.esa.int/"],
      ["Pipe | cell", "[LICENSE](LICENSE)"],
    ]);
  });
});

describe("CreditsPage", () => {
  it("renders one h1, a table with links, and a GitHub link for relative paths", () => {
    render(<CreditsPage markdown={SAMPLE} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Name", "Link"]);
    expect(screen.getByRole("link", { name: "a link" }).getAttribute("href")).toBe("https://x.org/a");
    expect(screen.getByRole("link", { name: "https://y.org/path" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "LICENSE" }).getAttribute("href")).toMatch(/github\.com\/.*\/blob\/main\/LICENSE$/);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("falls back to a message with the GitHub link when the file is missing", () => {
    render(<CreditsPage markdown={null} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(CREDITS_URL);
  });

  it("renders the real CREDITS.md with the IRSA and SPHEREx credit lines", () => {
    const md = readFileSync(path.join(process.cwd(), "..", "CREDITS.md"), "utf8");
    render(<CreditsPage markdown={md} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.body.textContent).toMatch(/NASA\/IPAC Infrared Science Archive/);
    expect(document.body.textContent).toMatch(/SPHEREx/);
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });
});

describe("AboutPage", () => {
  it("has one h1 and an h2 per section", () => {
    render(<AboutPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(ABOUT_SECTIONS.map((s) => s.heading));
  });
});
