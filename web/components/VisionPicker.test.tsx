// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VisionPicker, { VISION_OPTIONS } from "./VisionPicker";

afterEach(cleanup);

describe("VisionPicker", () => {
  it("lists the four modes and emits the chosen one", () => {
    const onChange = vi.fn();
    render(<VisionPicker value="normal" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Colour vision" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Normal",
      "Red-green (deutan/protan)",
      "Blue-yellow (tritan)",
      "Mono",
    ]);
    expect(VISION_OPTIONS.map((o) => o.value)).toEqual(["normal", "deutan", "tritan", "mono"]);
    fireEvent.change(select, { target: { value: "tritan" } });
    expect(onChange).toHaveBeenCalledWith("tritan");
  });

  it("shows protan as the red-green option", () => {
    render(<VisionPicker value="protan" onChange={() => {}} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("deutan");
  });
});
