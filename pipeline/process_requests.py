"""
Work through the "request a spot" queue by hand, on a laptop.

Visitors ask for a sky position on the website. Their request sits in the Supabase table
`spot_requests` with status `queued`. This script takes the next request(s), runs the
pipeline for that position, and prints the git commands that publish the result. It never
runs git and it is never run on the server.

For each request it does, in order:
    1. sets the request's status to `processing`
    2. motion_frames.py RA DEC --fov FOV       (downloads and builds the frames)
    3. shift_stack.py <the data/motion_* folder that step 2 wrote>   (the search)
    4. pipeline/export_web.py <that folder> --slug req-<id> ...       (files for the website)
    5. sets the status to `done`, or to `failed` if any step above exited with an error
       (then it says which step failed and its exit code, and moves on to the next request)

Setup (once)
    Put these two lines in a file called .env in the repo root (or in web/.env.local):
        SUPABASE_URL=https://<your-project>.supabase.co
        SUPABASE_SERVICE_ROLE_KEY=<the service_role key from the Supabase dashboard>
    The service key is a secret. It must never go into the web app, a commit or a chat.
    Environment variables with the same names also work. NEXT_PUBLIC_SUPABASE_URL is
    accepted in place of SUPABASE_URL.

Usage (run from anywhere; paths are resolved from the repo root)
    .venv\\Scripts\\python.exe pipeline/process_requests.py --list
        show the queued requests and stop; changes nothing
    .venv\\Scripts\\python.exe pipeline/process_requests.py --dry-run
        show what the next queued request would run; runs nothing, changes nothing
    .venv\\Scripts\\python.exe pipeline/process_requests.py
        process the next queued request (same as --limit 1)
    .venv\\Scripts\\python.exe pipeline/process_requests.py --limit 3
        process the three oldest queued requests, one after another
    .venv\\Scripts\\python.exe pipeline/process_requests.py --id 7
        process request 7 (any status, so a failed one can be tried again)
    .venv\\Scripts\\python.exe pipeline/process_requests.py --frames 5 --min-spacing 20
        pass these options on to motion_frames.py
    .venv\\Scripts\\python.exe pipeline/process_requests.py --env D:\\keys\\team.env
        read the settings from this file instead of the default .env files

Exit codes: 0 all good, 1 at least one request failed, 2 settings missing.

After a request is done, the script prints three git lines (add, commit, push). Copy and
run them yourself after you have looked at the result.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE_DIR = os.path.join(REPO_ROOT, "pipeline")
DEFAULT_ENV_FILES = [os.path.join(REPO_ROOT, ".env"),
                     os.path.join(REPO_ROOT, "web", ".env.local")]
STEP_NAMES = ["motion_frames.py", "shift_stack.py", "export_web.py"]
TABLE = "spot_requests"
EXIT_OK, EXIT_FAILED, EXIT_SETTINGS = 0, 1, 2


# ---------------------------------------------------------------- pure helpers

def load_env(path):
    """Read KEY=VALUE lines from a file. Blank lines and lines starting with # are skipped,
    an optional `export ` prefix is allowed, matching quotes are removed, and an unquoted
    value loses a trailing ` # comment`. A missing file gives an empty dict."""
    values = {}
    if not os.path.isfile(path):
        return values
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if not key:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            else:
                cut = value.find(" #")
                if cut != -1:
                    value = value[:cut].rstrip()
            values[key] = value
    return values


def motion_folder(ra, dec, start=None):
    """The folder motion_frames.py writes by default (its main(): os.path.join("data",
    f"motion_{a.ra}_{a.dec}{tag}") with ra and dec as Python floats, and tag = _<date of
    --start> when --start is given). Relative to the repo root, where the step runs."""
    tag = f"_{start[:10]}" if start else ""
    return os.path.join("data", f"motion_{float(ra)}_{float(dec)}{tag}")


def build_commands(request, opts):
    """The three command lines for one request, each a list of strings. `opts` needs
    `frames` and `min_spacing` (None when not given); they are only passed on when set."""
    py = sys.executable
    rid = request["id"]
    ra, dec = float(request["ra"]), float(request["dec"])
    fov = float(request["fov"])
    folder = motion_folder(ra, dec)

    motion = [py, os.path.join(REPO_ROOT, "motion_frames.py"), str(ra), str(dec),
              "--fov", str(fov)]
    if getattr(opts, "frames", None) is not None:
        motion += ["--frames", str(opts.frames)]
    if getattr(opts, "min_spacing", None) is not None:
        motion += ["--min-spacing", str(opts.min_spacing)]

    search = [py, os.path.join(REPO_ROOT, "shift_stack.py"), folder]

    export = [py, os.path.join(PIPELINE_DIR, "export_web.py"), folder,
              "--slug", f"req-{rid}",
              "--title", f"Field at RA {ra} Dec {dec}",
              "--difficulty", "medium",
              "--fov", str(fov)]
    return [motion, search, export]


def publish_commands(request):
    """The git lines a person runs after checking a finished request. Printed, never run."""
    rid = request["id"]
    return [
        f"git add web/public/fields/req-{rid} web/data/answers/req-{rid}.json "
        f"web/public/fields/index.json",
        f'git commit -m "Add requested field req-{rid}"',
        "git push",
    ]


def queue_url(base, limit=None, only_id=None):
    """REST URL for the queue, or for one request when only_id is given."""
    if only_id is not None:
        return f"{base}/rest/v1/{TABLE}?id=eq.{only_id}&limit=1"
    return (f"{base}/rest/v1/{TABLE}?status=eq.queued&order=created_at.asc"
            f"&limit={int(limit)}")


def status_url(base, rid):
    return f"{base}/rest/v1/{TABLE}?id=eq.{rid}"


def _command_text(cmd):
    return subprocess.list2cmdline([str(c) for c in cmd])


# ---------------------------------------------------------------- network and running

def _headers(key, patch=False):
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json"}
    if patch:
        headers["Prefer"] = "return=minimal"
    return headers


def default_http(method, url, headers, body=None):
    """Standard-library HTTP call. Returns the parsed JSON, or None for an empty reply."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8")) if raw.strip() else None


def default_run(cmd):
    """Run one step in the repo root, output streamed to this console. Returns its exit code."""
    return subprocess.run(cmd, cwd=REPO_ROOT, check=False).returncode


# ---------------------------------------------------------------- main flow

def _settings(env_files):
    """Merge settings: real environment first, then the files in order (first file wins)."""
    merged = {}
    for path in env_files:
        for key, value in load_env(path).items():
            merged.setdefault(key, value)
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") \
        or merged.get("SUPABASE_URL") or merged.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or merged.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    return url.strip().rstrip("/"), key.strip()


def _missing_message(url, key):
    lines = ["Cannot start: the settings for the Supabase database are missing:"]
    if not url:
        lines.append("  - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL): the project address, "
                     "e.g. https://<your-project>.supabase.co")
    if not key:
        lines.append("  - SUPABASE_SERVICE_ROLE_KEY: the secret service_role key from the "
                     "Supabase dashboard (not the anon key)")
    lines.append("Put them in a file named .env in the repo root (or web/.env.local), one per "
                 "line as KEY=VALUE, or set them as environment variables. Use --env PATH to "
                 "pick another file. Never commit that file.")
    return "\n".join(lines)


def _parse_args(argv):
    p = argparse.ArgumentParser(
        description="Process queued 'request a spot' jobs: run the pipeline and print the git "
                    "lines that publish the result. Run by hand on a laptop.")
    p.add_argument("--list", action="store_true", help="show the queue and stop")
    p.add_argument("--limit", type=int, default=1,
                   help="how many queued requests to process, oldest first (default 1)")
    p.add_argument("--id", type=int, help="process this one request (any status)")
    p.add_argument("--dry-run", action="store_true",
                   help="print the commands; run nothing, change nothing")
    p.add_argument("--frames", type=int, help="passed to motion_frames.py --frames")
    p.add_argument("--min-spacing", type=float, dest="min_spacing",
                   help="passed to motion_frames.py --min-spacing (hours)")
    p.add_argument("--env", help="read settings from this file instead of .env and web/.env.local")
    return p.parse_args(argv)


def _fetch(http, url, headers):
    rows = http("GET", url, headers, None)
    return rows or []


def _set_status(http, base, key, rid, status):
    http("PATCH", status_url(base, rid), _headers(key, patch=True), {"status": status})


def main(argv=None, http=default_http, run=default_run):
    """Entry point. Returns an exit code (the __main__ block passes it to sys.exit)."""
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    env_files = [args.env] if args.env else DEFAULT_ENV_FILES
    base, key = _settings(env_files)
    if not base or not key:
        print(_missing_message(base, key))
        return EXIT_SETTINGS

    headers = _headers(key)
    limit = args.limit if args.limit and args.limit > 0 else 1
    try:
        if args.id is not None:
            rows = _fetch(http, queue_url(base, only_id=args.id), headers)
        else:
            rows = _fetch(http, queue_url(base, limit=limit), headers)
    except Exception as exc:  # network trouble: say so in plain words
        code = getattr(exc, "code", None)
        extra = f" (HTTP {code})" if code else ""
        print(f"Could not read the queue from Supabase{extra}: {type(exc).__name__}. "
              f"Check the internet connection and the SUPABASE_URL value, then try again.")
        return EXIT_FAILED

    if args.list:
        if not rows:
            print("The queue is empty.")
            return EXIT_OK
        for r in rows:
            print(f"request {r.get('id')}: status {r.get('status')}, RA {r.get('ra')}, "
                  f"Dec {r.get('dec')}, FOV {r.get('fov')} deg, asked {r.get('created_at')}")
        return EXIT_OK

    if not rows:
        print("Nothing queued. Nothing to do.")
        return EXIT_OK

    opts = argparse.Namespace(frames=args.frames, min_spacing=args.min_spacing)
    any_failed = False
    for request in rows:
        rid = request["id"]
        print(f"\n=== request {rid}: RA {request['ra']} Dec {request['dec']} "
              f"FOV {request['fov']} deg ===")
        commands = build_commands(request, opts)

        if args.dry_run:
            for name, cmd in zip(STEP_NAMES, commands):
                print(f"[dry run] {name}: {_command_text(cmd)}")
            print("[dry run] then, when done, the publish lines:")
            for line in publish_commands(request):
                print(f"[dry run]   {line}")
            continue

        try:
            _set_status(http, base, key, rid, "processing")
        except Exception as exc:
            print(f"Could not set request {rid} to processing ({type(exc).__name__}); "
                  f"skipping it.")
            any_failed = True
            continue

        failed_step = None
        for name, cmd in zip(STEP_NAMES, commands):
            print(f"\n--- step {name} ---")
            print(f"$ {_command_text(cmd)}")
            try:
                code = run(cmd)
            except Exception as exc:
                print(f"Step {name} could not start: {type(exc).__name__}")
                code = 1
            if code != 0:
                failed_step = (name, code)
                break

        if failed_step:
            name, code = failed_step
            print(f"\nrequest {rid} FAILED at step {name} (exit code {code}).")
            any_failed = True
            _mark(http, base, key, rid, "failed")
            continue

        _mark(http, base, key, rid, "done")
        print(f"\nrequest {rid} done. To publish it, run these yourself after checking the result:")
        for line in publish_commands(request):
            print(f"  {line}")
    return EXIT_FAILED if any_failed else EXIT_OK


def _mark(http, base, key, rid, status):
    try:
        _set_status(http, base, key, rid, status)
        print(f"request {rid} set to {status}.")
    except Exception as exc:
        print(f"Could not set request {rid} to {status} ({type(exc).__name__}). "
              f"Set it by hand in the Supabase table editor.")


if __name__ == "__main__":
    sys.exit(main())
