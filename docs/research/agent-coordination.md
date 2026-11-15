# Coordinating three unattended agents through GitHub: gold standard vs our protocol

Scope: docs/plans/00-COORDINATION.md sections 2 and 3 plus scripts/poll.sh. Marks: [v] fetched and read this session, [s] seen only in a search snippet or secondary summary, [u] unchecked (from memory, not fetched).

## 1. What the sources say

### Anthropic / Claude Code
- Parallel sessions: one git worktree per session, each on its own branch ("claude --worktree name"). [v] https://code.claude.com/docs/en/common-workflows
- Agent teams: experimental, off by default. A lead plus teammates share a task list with pending/in-progress/completed and dependency states. Claiming uses file locking. [v] https://code.claude.com/docs/en/agent-teams
- Agent teams limits: one team per session, no nested teams, no resume of in-process teammates, task status can lag so a dependent task looks stuck. Teammates are not spawned in `-p` headless mode. [v] same page. They live inside one session on one machine, so they do not span our three machines and three GitHub accounts.
- Cross-session messaging exists, with a setting that gates messages leaving the machine (`isolatePeerMachines`). Our three agents sit on different machines, so GitHub stays the only channel. [v] https://code.claude.com/docs/en/cross-session-messaging
- Claude Code GitHub Action: `@claude` in an issue or PR comment triggers a run (interactive mode). A workflow with a `prompt` input runs without a mention (automation mode). Needs an Anthropic API key secret and `contents/pull-requests/issues: write`. [v] https://code.claude.com/docs/en/github-actions
- Headless `claude -p` is the CI/scripting entry point. [v] https://code.claude.com/docs/en/common-workflows
- Carlini, "Building a C compiler with parallel Claudes": 16 agents in separate containers, one shared repo, tasks claimed with lock files, no orchestrator, frequent merge conflicts handled by the agents themselves. Details are from secondary write-ups [s]; original https://www.anthropic.com/engineering/building-c-compiler was fetched but I did not read the lock-file passage, so treat as [u].

### Other frameworks and field evidence
- Cursor, hundreds of agents for a week on one branch: agents self-coordinating through a shared file with locks failed (locks held too long or forgotten; 20 agents ran at the throughput of 2 to 3). Optimistic concurrency was simpler but flat agents became risk-averse and dodged hard tasks. They moved to planner/worker roles; an "integrator" role for conflict resolution became a bottleneck and was removed because workers resolve conflicts themselves. "Too little structure and agents conflict, duplicate work, and drift. Too much structure creates fragility." Periodic fresh starts fight drift. [v] https://cursor.com/blog/scaling-agents
- Copilot coding agent: assigned via an issue, works on a branch, opens a PR, cannot approve or merge its own PR; the requester cannot approve it either; it reads the issue only at assignment, so later info must go in a PR comment; only write-access comments are processed. [s] https://docs.github.com/en/copilot/using-github-copilot/coding-agent/using-copilot-to-work-on-an-issue
- MAST (1600+ traces, 7 frameworks): 14 failure modes in 3 clusters: system design, inter-agent misalignment, task verification. Verification failures are a top cluster. [v, abstract] https://arxiv.org/abs/2503.13657
- AgenticFlict: 27.67% of 107K processed agent PRs had textual merge conflicts. [v, abstract] https://arxiv.org/abs/2604.03551
- Failed agent PRs touch more files and fail CI more often; doc/CI/build tasks merge best, bug-fix and performance worst. [v, abstract] https://arxiv.org/abs/2601.15195
- OpenHands, SWE-agent, Devin, MetaGPT, ChatDev: not fetched. Their role/SOP designs are single-run pipelines, not multi-account GitHub teams; no claim made. [u]

### Branching, ownership, contracts
- Trunk-based: short-lived branches, one owner, a couple of days at most; the page names coding agents joining your branch and merging into other people's branches as contract breaks, and warns that worktrees let branches drift sideways. [v] https://trunkbaseddevelopment.com/short-lived-feature-branches/
- Merge queue: needs the `merge_group` trigger in required-check workflows or the merge fails; settings include merge method and build concurrency. Plan and repo-type availability not checked [u]. [v] https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- CODEOWNERS: last matching pattern wins; owners need explicit write access; all owners for one pattern go on one line. Combined with branch protection "require review from code owners" it enforces file ownership mechanically. [v] https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners (the "require review" setting is [u]).
- Consumer-driven contracts (Pact): consumers publish expectations, providers verify them in CI, tests target messages not behaviour. [v] https://docs.pact.io/getting_started/how_pact_works. For us the light version is a shared fixture plus a type-check or schema script that both sides run.

### GitHub API limits and notifications
- Primary limit: 5,000 requests/h per user (REST) and 5,000 points/h per user (GraphQL). [v] https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api and https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api
- Secondary: 100 concurrent requests, 2,000 GraphQL points/min, 80 content-creating requests/min and 500/h. [v] same pages.
- Notifications endpoint: `Last-Modified` plus `If-Modified-Since` returns 304 and leaves the rate limit untouched; obey `X-Poll-Interval`. Classic PAT only, scopes `notifications` or `repo`. [v] https://docs.github.com/en/rest/activity/notifications
- Actions can fire on `issues`, `issue_comment`, `pull_request`, `label` events, so a workflow can label, comment, or fail a check with no agent awake. `merge_group` is its own event. [v] https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows. A GITHUB_TOKEN-made event not triggering further workflows is [u].
- Webhooks need a public endpoint; our agents have none, so webhooks are out. [u, design inference]

## 2. Our poll against the limit
poll.sh makes 4 gh calls per run: issue list, issue view 3, pr list, issue view 2 (git fetch is not an API call). Assume about 1 GraphQL query each, ~1 point each [u: points per query not measured]. At /loop 15m that is 4 runs/h = 16 calls/h per agent, about 0.3% of 5,000. Each agent has its own account, so budgets are separate. Even a 1-minute loop (240 calls/h) is under 5%. Rate limit is a non-issue. The real costs are context and latency: `gh issue view --comments | tail` downloads the full thread each time, and the 15-minute cadence makes the "reply in 15 minutes" and "20 minutes of silence then merge" rules fire at 15 to 30 minutes of real delay. Measure real cost once with `gh api rate_limit` before and after one run.

## 3. Judgment of our protocol
Strong already: one owner per path, per-agent branches, squash-only merge into `web`, review pairs, contract-by-issue, a single batched human issue with defaults, no waiting on humans, small shared-file rules (credits CSV per agent, package.json commit rule). This matches the "structure in the middle" lesson and the contract-first and trunk-based advice.

Gaps against the gold standard:
1. Ownership is prose only. Nothing blocks an agent from editing another's path; nothing flags it.
2. No CI. The green check is a pasted line the author writes about their own work, so verification (a top MAST cluster) is self-reported. "Merge after 20 minutes of silence" lets unreviewed code in.
3. Contracts are markdown plus issue consent. Nothing checks code against them, so drift is silent.
4. Branches `web-data`, `web-game`, `web-server` are long-lived by design, not short-lived: three diverging trunks that only meet at PR time (the TBD "sideways drift" risk). Rebase happens only when polled.
5. Polling discovers everything every time, including unchanged state; there is no cheap change signal.
6. Task claiming is by "taking it" comment: no lock, but also no stale-claim expiry.

## 4. Failure modes in our setup and cheapest guard
- Stale contracts: an agent builds against a contract version that changed. Guard: contract files carry a version line; PR template asks the contract version used; a CI step greps for it.
- Merge conflicts: ~28% of agent PRs conflict in the wild; ours concentrate on web/package.json, layout.tsx, globals.css, lib/types.ts. Guard: CODEOWNERS plus rebase before every PR, one-line dependency commits (already in 3.3 and section 2), PRs under ~400 lines.
- Duplicated work: two agents build the same helper or component. Guard: 3.2 "taking it" comment becomes a required label `claimed:<agent>` plus a stale-claim rule (no commit for 60 min means claim void); list new shared helpers on the board before writing them.
- Agents waiting on each other: a blocked agent idles or invents a stub. Guard: every contract ships a stub or fixture within 40 minutes (section 4 already), and a rule "blocked more than 15 minutes, switch to the next item on your own list and post it on the board". Merge on silence is the right call; keep it.
- Silent drift: code diverges from contract or from the plan without any comment. Guard: a CI check that runs on every PR (typecheck, `next build`, contract schema check) so drift fails loudly; a weekly-style board audit every 3 hours where each agent lists commits that touched a path it does not own.
- Dead poller (not in the list but likely): the /loop session crashes or compacts and nobody notices. Guard: board comment at least hourly; any agent that sees another silent for 2 hours opens a `blocked` issue to it and takes over the smaller task.

## Change in our protocol
1. Add `.github/CODEOWNERS` generated from section 2 (every path to its owner) and turn on "require review from code owners" on `web`; this makes review pairs automatic and flags foreign-path edits. Source: GitHub CODEOWNERS docs [v]. Guards merge conflicts and ownership drift.
2. Add one GitHub Actions workflow on `pull_request` into `web` running typecheck, `next build`, vitest and a contract-schema check; make it a required check so the pasted test line is replaced by a real one. Source: failed-agent-PR study [v], MAST verification cluster [v]. Guards silent drift and unverified merges.
3. Replace "merge after 20 minutes of silence" with "merge when CI is green and either approved or 20 minutes passed"; red CI never merges. Source: Copilot agent cannot self-approve [s] and the CI point above. Guards unreviewed breakage.
4. Put a `Contract-Version: <sha or n>` line in every contract file and a matching line in the PR body; CI fails if the PR's version is behind `web`. Source: consumer-driven contracts [v]. Guards stale contracts.
5. Make task claiming a label: `claimed:<agent>` set by the receiver within 15 minutes, auto-void when the issue has no linked commit or comment for 60 minutes. Source: Cursor lock failures, forgotten locks [v]. Guards duplicated work and stuck claims.
6. Keep branches short: rebase on `web` before every push and merge a PR at least every 2 hours (a milestone may be one slice, not a whole phase); never merge into another agent's branch. Source: trunk-based development [v]. Guards merge conflicts and drift.
7. Upgrade poll.sh with a cheap gate: `gh api notifications -H "If-Modified-Since: <saved>"` (classic PAT) or a compare of `gh api repos/:o/:r/issues?since=` and `git ls-remote` heads against a saved state file; run the full four-call poll only on change, and print `--json` slim fields instead of full threads. Source: notifications docs [v]. Guards agents waiting on each other and context bloat; allows a 5-minute loop at negligible quota.
8. Add a 5-line "blocked more than 15 minutes" rule: post on the board, pick the next item from your own list, never stub another owner's file. Source: Cursor "too little structure" finding [v]. Guards agents waiting on each other.
9. Add a Claude Code Action workflow only if an API key secret is available: `@claude` in a PR comment runs a contract-check review (automation mode). Optional, since our agents already review each other. Source: Claude Code GitHub Actions docs [v]. Guards silent drift.
10. Add a `watchdog` line to the board rule: if an agent has been silent 2 hours, the review-pair partner opens a `blocked` issue and posts it on #3 with a default of "reassign its next item to the partner". Source: Cursor periodic restart and drift [v]. Guards dead pollers and silent drift.
11. Do not adopt a merge queue, agent teams, an integrator role or webhooks: merge queue needs required checks and `merge_group` and gains little at 3 agents [v/u]; teams are single-session [v]; integrator became a bottleneck at Cursor [v]; webhooks need a public endpoint [u].
