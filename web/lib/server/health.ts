// Service health checks for GET /api/health and the /status page. Server only.
// Contract: docs/contracts/api.md section 10. Every probe is cheap and read-only.

import { unlockConfigured } from "@/lib/server/unlock";

export type HealthStatus = "green" | "amber" | "red";

export type ServiceHealth = {
  id: string;
  name: string;
  status: HealthStatus;
  ms: number;
  http: number | null;
  message: string;
  /** False only for supabase when no database URL is set. Omitted otherwise (additive, contract 10). */
  configured?: boolean;
};

export type HealthReport = {
  checked_at: string;
  overall: HealthStatus;
  services: ServiceHealth[];
  /** Problems in our own setup (not an outside service). Present only when there is one. */
  warnings?: string[];
};

export const UNLOCK_WARNING = "UNLOCK_SECRET is not set: finished spots will lock again.";

/** Configuration problems for the status page. Not a service, so never in `services`. */
export function configWarnings(env: Record<string, string | undefined>): string[] {
  const w: string[] = [];
  if (env.NODE_ENV === "production" && !unlockConfigured(env)) w.push(UNLOCK_WARNING);
  return w;
}

type Fetch = typeof fetch;

export const PROBE_TIMEOUT_MS = 5000;
export const SLOW_MS = 2000;
export const CACHE_MS = 60_000;

type Probe = {
  id: string;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** True if this HTTP status proves the service is up. Default: any 2xx. */
  accept?: (status: number) => boolean;
  /** What to tell the player when it fails: say what still works. */
  failMessage: string;
};

const is2xx = (s: number) => s >= 200 && s < 300;

/**
 * Probe choices (checked 2026-11-15):
 * - irsa_sia: HEAD on a one-row SIA query. IRSA answers HEAD with 200 and no body.
 * - irsa_s3: HEAD on the bucket root. Any status below 500 (200, 403, 404) means S3 answers.
 * - cds_sesame: tiny GET of the name resolver for "M101". cds.unistra.fr redirects to a mirror; fetch follows.
 * - cds_hips: GET of `properties` at the `hips_service_url` the MocServer record gives for
 *   CDS/P/SPHEREx/QR2/color (https://alasky.cds.unistra.fr/SPHEREx/color).
 * - simbad_tap, gaia_tap: the TAP `/availability` resource (VOSI).
 * - jpl_horizons: GET with MAKE_EPHEM=NO, which returns object info only (no ephemeris work).
 * - jpl_sbident: GET for a geocentric observer (xobs=0,0,0,0,0,0), a 0.01 degree field and
 *   numbered comets only (sb-kind=c, sb-ns=n): HTTP 200 in about 0.7 s on 2026-11-15. The old
 *   all-asteroid query of a 0.1 degree field took about 18 s, far over the 5 s probe timeout.
 */
function probes(env: NodeJS.ProcessEnv): Probe[] {
  const list: Probe[] = [
    {
      id: "irsa_sia",
      name: "IRSA image search",
      url: "https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&POS=circle+13.2+14.4+0.01&MAXREC=1",
      method: "HEAD",
      failMessage: "IRSA is not answering right now. Ready spots still work; quick look may fail.",
    },
    {
      id: "irsa_s3",
      name: "IRSA image files (AWS S3)",
      url: "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/",
      method: "HEAD",
      accept: (s) => s < 500,
      failMessage: "The SPHEREx file store is not answering right now. Ready spots still work; quick look will fail.",
    },
    {
      id: "cds_sesame",
      name: "CDS name lookup (Sesame)",
      url: "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?M101",
      method: "GET",
      failMessage: "Name lookup is not answering right now. Typing coordinates still works; names may fail.",
    },
    {
      id: "cds_hips",
      name: "CDS sky map (HiPS)",
      url: "https://alasky.cds.unistra.fr/SPHEREx/color/properties",
      method: "GET",
      failMessage: "The all-sky background is not answering right now. Ready spots still play; the sky map may stay dark.",
    },
    {
      id: "simbad_tap",
      name: "SIMBAD catalogue",
      url: "https://simbad.cds.unistra.fr/simbad/sim-tap/availability",
      method: "GET",
      failMessage: "SIMBAD is not answering right now. Ready spots still work; object names and types may be missing.",
    },
    {
      id: "gaia_tap",
      name: "Gaia archive",
      url: "https://gea.esac.esa.int/tap-server/tap/availability",
      method: "GET",
      failMessage: "The Gaia archive is not answering right now. Ready spots still work; star distances may be missing.",
    },
    {
      id: "jpl_horizons",
      name: "JPL Horizons",
      url: "https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND=%27499%27&MAKE_EPHEM=NO",
      method: "GET",
      failMessage: "JPL Horizons is not answering right now. Ready spots still work; asteroid distances may be missing.",
    },
    {
      id: "jpl_sbident",
      name: "JPL asteroid identification",
      url:
        "https://ssd-api.jpl.nasa.gov/sb_ident.api?xobs=0,0,0,0,0,0&obs-time=2026-01-01&fov-ra-center=10-00-00&fov-dec-center=%2B00-00-00&fov-ra-hwidth=0.01&fov-dec-hwidth=0.01&sb-kind=c&sb-ns=n",
      method: "GET",
      failMessage: "JPL asteroid identification is not answering right now. Ready spots still work; known-asteroid checks may fail.",
    },
  ];
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (base) {
    const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    list.push({
      id: "supabase",
      name: "Database and login (Supabase)",
      url: `${base}/auth/v1/health`,
      method: "GET",
      headers: key ? { apikey: key } : undefined,
      failMessage: "The database is not answering right now. Guest play works; scores may not be saved.",
    });
  }
  return list;
}

const SUPABASE_OFF: ServiceHealth = {
  id: "supabase",
  name: "Database and login (Supabase)",
  status: "amber",
  ms: 0,
  http: null,
  message: "No database is connected. Guest play works; scores are not saved.",
  configured: false,
};

const TIMED_OUT = Symbol("timeout");

async function runProbe(p: Probe, fetchImpl: Fetch, now: () => number, timeoutMs: number): Promise<ServiceHealth> {
  const t0 = now();
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve(
      fetchImpl(p.url, {
        method: p.method,
        headers: p.headers,
        signal: ctl.signal,
        cache: "no-store",
        redirect: "follow",
      }),
    );
    call.catch(() => {}); // a late rejection after the timeout must not be unhandled
    const res = await Promise.race([call, timeout]);
    const ms = Math.max(0, Math.round(now() - t0));
    if (res === TIMED_OUT) {
      return { id: p.id, name: p.name, status: "red", ms: timeoutMs, http: null, message: p.failMessage };
    }
    // Free the connection; the body is never read.
    void res.body?.cancel().catch(() => {});
    const ok = (p.accept ?? is2xx)(res.status);
    if (!ok) return { id: p.id, name: p.name, status: "red", ms, http: res.status, message: p.failMessage };
    if (ms >= SLOW_MS) {
      return {
        id: p.id,
        name: p.name,
        status: "amber",
        ms,
        http: res.status,
        message: `Answering slowly (${(ms / 1000).toFixed(1)} s). Things that use it may take longer than usual.`,
      };
    }
    return { id: p.id, name: p.name, status: "green", ms, http: res.status, message: `Answering normally (${ms} ms).` };
  } catch {
    const ms = Math.max(0, Math.round(now() - t0));
    return { id: p.id, name: p.name, status: "red", ms, http: null, message: p.failMessage };
  } finally {
    clearTimeout(timer);
  }
}

const RANK: Record<HealthStatus, number> = { green: 0, amber: 1, red: 2 };

/**
 * Contract: overall is the worst status. A Supabase that is not configured is amber (never red),
 * so on its own it makes overall amber.
 */
export function worst(services: ServiceHealth[]): HealthStatus {
  return services.reduce<HealthStatus>((w, s) => (RANK[s.status] > RANK[w] ? s.status : w), "green");
}

/** Probe every service in parallel, 5 s each. Never throws. */
export async function checkAll(
  fetchImpl: Fetch = fetch,
  now: () => number = Date.now,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HealthReport> {
  const list = probes(env);
  const results = await Promise.all(list.map((p) => runProbe(p, fetchImpl, now, timeoutMs)));
  const services = list.some((p) => p.id === "supabase") ? results : [...results, { ...SUPABASE_OFF }];
  const warnings = configWarnings(env);
  return {
    checked_at: new Date(now()).toISOString(),
    overall: worst(services),
    services,
    ...(warnings.length ? { warnings } : {}),
  };
}

let cached: { at: number; report: HealthReport } | null = null;
let inflight: Promise<HealthReport> | null = null;

/** Cached for 60 s; callers that arrive during a check share it. */
export async function getHealth(fetchImpl: Fetch = fetch, now: () => number = Date.now): Promise<HealthReport> {
  if (cached && now() - cached.at < CACHE_MS) return cached.report;
  if (inflight) return inflight;
  inflight = checkAll(fetchImpl, now)
    .then((report) => {
      cached = { at: now(), report };
      return report;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function resetHealthCache(): void {
  cached = null;
  inflight = null;
}
