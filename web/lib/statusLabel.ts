// Words for a service on the status page. Pure, no server imports: safe in client components.
// Contract: docs/contracts/api.md section 10 (`configured`).

export type ServiceStatus = "green" | "amber" | "red";

export type StatusLabel = "Working" | "Slow" | "Not answering" | "Not connected";

const WORD: Record<ServiceStatus, StatusLabel> = {
  green: "Working",
  amber: "Slow",
  red: "Not answering",
};

/** A service that is not set up says "Not connected", whatever its status. */
export function statusLabel(service: { status: ServiceStatus; configured?: boolean }): StatusLabel {
  if (service.configured === false) return "Not connected";
  return WORD[service.status];
}
