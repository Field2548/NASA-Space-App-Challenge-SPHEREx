"use client";

// Temporary demo page owned by SERVER; delete when GAME mounts these components.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { AuthDialog } from "@/components/AuthDialog";
import { InspectPopup } from "@/components/InspectPopup";
import { Scoreboard } from "@/components/Scoreboard";
import { loadField, loadFrames, type Frame } from "@/lib/fields";
import type { Field } from "@/lib/types";

const GRID = 119;
const SCALE = 3; // 119 grid pixels x 3 screen pixels = 357 px box

type Spot = { x: number; y: number; click: { x: number; y: number } };

/** Screen position of the centre of grid pixel (x, y) inside the box. */
function pixelCentre(box: HTMLDivElement, x: number, y: number) {
  const r = box.getBoundingClientRect();
  return {
    x: r.left + box.clientLeft + x * SCALE + SCALE / 2,
    y: r.top + box.clientTop + y * SCALE + SCALE / 2,
  };
}

export function ServerDemo() {
  const [field, setField] = useState<Field | null>(null);
  const [frames, setFrames] = useState<Frame[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [explore, setExplore] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [answer, setAnswer] = useState<string>("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadField("eros")
      .then(async (f) => {
        const fr = await loadFrames(f);
        if (live) {
          setField(f);
          setFrames(fr);
        }
      })
      .catch((e: unknown) => {
        if (live) setLoadError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      live = false;
    };
  }, []);

  const mode = explore ? "explore" : "round";

  function onBoxClick(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget;
    const r = box.getBoundingClientRect();
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor((e.clientX - r.left - box.clientLeft) / SCALE)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor((e.clientY - r.top - box.clientTop) / SCALE)));
    setSpot({ x: gx, y: gy, click: { x: e.clientX, y: e.clientY } });
  }

  function openAtPixel(x: number, y: number) {
    const box = boxRef.current;
    const click = box ? pixelCentre(box, x, y) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setSpot({ x, y, click });
  }

  async function submitCorrect() {
    setAnswer("Sending...");
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spot: "eros",
          answer: "track",
          marks: [
            { frame: 1, x: 84, y: 79 },
            { frame: 3, x: 40, y: 43 },
          ],
        }),
      });
      const text = await res.text();
      let shown = text;
      try {
        shown = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON: show the raw body.
      }
      setAnswer(`HTTP ${res.status}\n${shown}`);
    } catch (e) {
      setAnswer(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Server components demo</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-start" }}>
        <Scoreboard slug="eros" />

        <div style={{ display: "grid", gap: "var(--space-3)", justifyItems: "start" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}>
            <button type="button" onClick={() => setLoginOpen(true)}>
              Open login
            </button>
            <label style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
              <input type="checkbox" checked={explore} onChange={(e) => setExplore(e.target.checked)} />
              explore mode
            </label>
            <button type="button" disabled={!field} onClick={() => openAtPixel(84, 79)}>
              Inspect Eros frame-1 position
            </button>
            <button type="button" onClick={submitCorrect}>
              Submit correct Eros answer
            </button>
          </div>

          {loadError ? (
            <p role="alert" style={{ margin: 0, color: "var(--magenta)" }}>
              Could not load the Eros field: {loadError}
            </p>
          ) : null}

          <div
            ref={boxRef}
            onClick={onBoxClick}
            style={{
              width: GRID * SCALE,
              height: GRID * SCALE,
              boxSizing: "border-box",
              border: "1px solid var(--line)",
              cursor: "crosshair",
            }}
          />

          {answer ? (
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", maxWidth: 420 }}>{answer}</pre>
          ) : null}
        </div>
      </div>

      {spot && field ? (
        <InspectPopup
          field={field}
          frames={frames}
          x={spot.x}
          y={spot.y}
          click={spot.click}
          mode={mode}
          onClose={() => setSpot(null)}
        />
      ) : null}

      <AuthDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
