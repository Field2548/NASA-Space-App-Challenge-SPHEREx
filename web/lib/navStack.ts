// In-tab record of the pages visited by client-side navigation, for BackLink. document.referrer only
// describes the full page load, so after a <Link> move it still names the page before the site (or
// nothing). NavTracker (root layout) calls trackPath on every pathname change.

let stack: string[] = [];

/** Record that `path` is now shown. A move to the page before the current one counts as going back. */
export function trackPath(path: string): void {
  if (stack.at(-1) === path) return;
  if (stack.at(-2) === path) stack.pop();
  else stack.push(path);
}

/** True when an earlier page of this visit was reached in-app, so history back stays on the site. */
export function hasInSitePrevious(): boolean {
  return stack.length > 1;
}

export function resetNavStack(): void {
  stack = [];
}
