// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import InfoPopover from "./InfoPopover";

afterEach(cleanup);

describe("InfoPopover", () => {
  it("opens a dialog from the (i) button, closes on Escape and returns focus", () => {
    render(
      <InfoPopover label="Morphology" title="About morphology">
        <p>Plain words.</p>
      </InfoPopover>,
    );
    const btn = screen.getByRole("button", { name: "About Morphology" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    btn.focus();
    fireEvent.click(btn);
    const dlg = screen.getByRole("dialog", { name: "About morphology" });
    expect(dlg.textContent).toContain("Plain words.");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it("opening a second (i) closes the first, so only one is open", () => {
    render(
      <>
        <InfoPopover label="A" title="About A">
          <p>a</p>
        </InfoPopover>
        <InfoPopover label="B" title="About B">
          <p>b</p>
        </InfoPopover>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "About A" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "About B" }));
    const open = screen.getAllByRole("dialog");
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toContain("About B");
  });

  it("closes with its Close button", () => {
    render(<InfoPopover label="X" title="T">body</InfoPopover>);
    fireEvent.click(screen.getByRole("button", { name: "About X" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
