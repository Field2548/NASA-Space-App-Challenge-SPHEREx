#!/usr/bin/env bash
# Poll routine from docs/plans/00-COORDINATION.md section 3.4.
# Usage: scripts/poll.sh <data|game|server>
# Read-only: it fetches and prints. Rebase onto web yourself afterwards.
set -u
me=${1:?usage: scripts/poll.sh data|game|server}
board=2

git fetch -q origin
echo "== open issues to:$me"
gh issue list --state open --label "to:$me"
echo "== human decisions #3, latest (a [HUMAN] comment overrides a default)"
gh issue view 3 --comments | tail -n 20
echo "== open PRs (review yours per the review pairs)"
gh pr list --state open
echo "== TEAM BOARD #$board, latest"
gh issue view "$board" --comments | tail -n 40
echo "== commits on origin/web not in your branch"
git log --oneline HEAD..origin/web | head -n 20
