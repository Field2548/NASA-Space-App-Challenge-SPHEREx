// Is NASA's IRSA archive answering? Used by the Frames stepper popup. Reads GET /api/health once and keeps
// the answer for a few minutes so repeated clicks do not spam the server.

export type ArchiveStatus = "up" | "down" | "unknown";

const KEEP_MS = 5 * 60_000;
let cached: { at: number; status: ArchiveStatus } | null = null;

/** "down" when the IRSA image search or the IRSA image store is red in a /api/health body. */
export function archiveFromHealth(body: unknown): ArchiveStatus {
  const services = (body as { services?: unknown } | null)?.services;
  if (!Array.isArray(services)) return "unknown";
  const irsa = services.filter((s): s is { id: string; status: string } => typeof s?.id === "string" && s.id.startsWith("irsa"));
  if (irsa.length === 0) return "unknown";
  return irsa.some((s) => s.status === "red") ? "down" : "up";
}

export async function getArchiveStatus(): Promise<ArchiveStatus> {
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.status;
  let status: ArchiveStatus = "unknown";
  try {
    const res = await fetch("/api/health");
    if (res.ok) status = archiveFromHealth(await res.json());
  } catch {
    /* status stays unknown */
  }
  if (status !== "unknown") cached = { at: Date.now(), status };
  return status;
}

export function resetArchiveStatus(): void {
  cached = null;
}

/** The sentence for the popup. */
export function archiveMessage(status: ArchiveStatus | "checking", n: number): string {
  const have = `${n} ${n === 1 ? "frame is" : "frames are"} shown`;
  if (status === "checking") return "Checking whether more frames can be downloaded…";
  if (status === "down") return `More frames can't be downloaded right now: NASA's IRSA archive is not responding. Try again later. This spot has ${n} frames loaded.`;
  if (status === "unknown") return `We couldn't check the status of NASA's IRSA archive, so we can't say whether more frames can be downloaded. ${have}.`;
  return `This spot comes with ${n} frames, and they're all shown.`;
}
