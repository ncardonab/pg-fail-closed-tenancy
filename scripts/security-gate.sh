#!/usr/bin/env bash
# Security gate: leaked secrets, risky code patterns, known-vulnerable
# dependencies. CI runs it on every push and pull request.
#
#   npm run security
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
say() { printf '\n== %s\n' "$*"; }
need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "Missing $1. Install it with: $2"
  exit 1
}

need gitleaks "brew install gitleaks"
need opengrep "see https://github.com/opengrep/opengrep/releases"
need osv-scanner "brew install osv-scanner"

say "gitleaks (whole git history)"
gitleaks git --redact --no-banner . || fail=1

say "opengrep (bundled rules)"
opengrep scan --config=auto --severity WARNING --severity ERROR --quiet --error . || fail=1

say "osv-scanner (lockfile)"
osv-scanner scan source -r . || fail=1

echo
if [ "$fail" -ne 0 ]; then
  echo "SECURITY GATE: red"
  exit 1
fi
echo "SECURITY GATE: green"
