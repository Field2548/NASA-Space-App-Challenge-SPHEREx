"use client";
// /play with URL state: the view params (frames, spacing, vision) seed PlayScreen and every change
// is written back with router.replace, so the address restores the view without history spam.
// ra, dec and fov are not read: the viewer has no pan or field-of-view state. Zoom (`scale`)
// exists in PlayScreen but is not written to the URL.

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import PlayScreen from "./PlayScreen";
import { applyView, parseView, type RawParams, type ViewState } from "./viewState";

export default function PlayRoute({ spot, params }: { spot?: string; params: RawParams }) {
  const router = useRouter();
  const initialView = useMemo(() => parseView(params), [params]);
  const onViewChange = useCallback(
    (v: ViewState) => {
      const current = new URLSearchParams(window.location.search);
      const next = applyView(current, v);
      if (next.toString() === current.toString()) return;
      const q = next.toString();
      router.replace(q ? `/play?${q}` : "/play", { scroll: false });
    },
    [router],
  );
  return <PlayScreen spot={spot} initialView={initialView} onViewChange={onViewChange} />;
}
