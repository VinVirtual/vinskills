#!/usr/bin/env bash
# Clone the last commit of a repository into a throwaway folder and run its tests there.
# Catches files that exist on your disk but were never committed.
#   fresh-clone-check.sh <repo> [test command...]
# The test command defaults to: npm test (package.json), else pytest, else ./check_env.sh.
set -euo pipefail

repo="${1:?usage: fresh-clone-check.sh <repo> [test command...]}"
shift || true
repo="$(cd "$repo" && pwd)"
scratch="$repo/.scratch"
mkdir -p "$scratch"
dest="$(mktemp -d "$scratch/fresh-clone.XXXXXX")"
cleanup() { rm -rf -- "$dest"; }
trap cleanup EXIT

if [ -n "$(git -C "$repo" status --porcelain)" ]; then
  echo "note: uncommitted changes are NOT in the clone (that is the point)."
fi
git clone --quiet --no-hardlinks "$repo" "$dest/repo"
cd "$dest/repo"
echo "cloned $(git rev-parse --short HEAD) into $dest/repo"

if [ "$#" -gt 0 ]; then
  echo "+ $*"
  "$@"
elif [ -f package.json ]; then
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --ignore-scripts >/dev/null; fi
  echo "+ npm test"
  npm test
elif ls tests/*.py >/dev/null 2>&1 || [ -f pytest.ini ] || [ -f pyproject.toml ]; then
  echo "+ python3 -m pytest -q"
  python3 -m pytest -q
elif [ -x ./check_env.sh ]; then
  echo "+ ./check_env.sh"
  ./check_env.sh
else
  echo "no test command found; pass one after the repo path" >&2
  exit 2
fi
echo "fresh clone: OK"
