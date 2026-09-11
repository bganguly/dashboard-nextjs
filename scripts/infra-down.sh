#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"

_local_running=0
_lite_count=0
_full_count=0

lsof -ti:3000 >/dev/null 2>&1 && _local_running=1 || true

_pulumi_stack_count() {
  local stack="$1"
  ( cd "$INFRA_DIR" 2>/dev/null && \
    pulumi stack ls --json 2>/dev/null | python3 -c "
import json,sys
try:
    data=json.load(sys.stdin)
    for s in data:
        if s.get('name')=='$stack':
            print(s.get('resourceCount',0))
            sys.exit(0)
    print(0)
except Exception:
    print(0)
" 2>/dev/null ) || printf '0'
}

if command -v pulumi >/dev/null 2>&1 && pulumi whoami >/dev/null 2>&1; then
  _lite_count=$(_pulumi_stack_count lite)
  _full_count=$(_pulumi_stack_count full)
fi

_CHAINED=0
if [[ -n "${DEPLOY_MODE:-}" ]]; then
  _TARGET="remote"
  _CHAINED=1
  printf '\n=== dashboard-nextjs teardown (chained, mode: %s) ===\n' "$DEPLOY_MODE"
else
  printf '\n=== dashboard-nextjs teardown ===\n\n'
  printf '  [1] Local  — stop local dev server (port 3000)'
  (( _local_running )) && printf ' [running]' || printf ' [not detected]'
  printf '\n'
  printf '  [2] Lite   — destroy GCP lite (Cloud Run nextjs, dash-nextjs-lite-*)'
  (( _lite_count > 0 )) && printf ' [%s resources active]' "$_lite_count" || printf ' [not deployed]'
  printf '\n'
  printf '  [3] Full   — destroy GCP full (Cloud Run nextjs, dash-nextjs-full-*)'
  (( _full_count > 0 )) && printf ' [%s resources active]' "$_full_count" || printf ' [not deployed]'
  printf '\nChoice [1/2/3]: '
  read -r _MODE
  case "$_MODE" in
    2) _TARGET="remote"; DEPLOY_MODE="lite" ;;
    3) _TARGET="remote"; DEPLOY_MODE="full" ;;
    *)  _TARGET="local";  DEPLOY_MODE=""    ;;
  esac
fi

if [[ "$_TARGET" == "local" ]]; then
  printf '\nStopping local Next.js dev server (port 3000)...\n'
  "$ROOT_DIR/scripts/free-port.sh" 3000
  printf 'Local dev server stopped.\n'
  exit 0
fi

ENV_FILE="$ROOT_DIR/.env.gcp.${DEPLOY_MODE}"
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

PULUMI_USER=$(pulumi whoami 2>/dev/null || true)
[[ -n "$PULUMI_USER" ]] || { printf 'Not logged in to Pulumi. Run: pulumi login\n' >&2; exit 1; }

DETECTED_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
GCP_PROJECT="${DETECTED_PROJECT:-${GCP_PROJECT:-}}"
[[ -n "$GCP_PROJECT" ]] || { printf 'No GCP project detected. Run: gcloud config set project <id>\n' >&2; exit 1; }

DETECTED_REGION=$(gcloud config get-value compute/region 2>/dev/null || true)
GCP_REGION="${DETECTED_REGION:-${GCP_REGION:-us-central1}}"

printf '\nThis will destroy the Next.js GCP resources in project %s (%s).\n' "$GCP_PROJECT" "$GCP_REGION"
if (( _CHAINED == 0 )); then
  printf 'Proceed? [Y/n] '
  read -r yn
  [[ -z "$yn" || "$yn" =~ ^[Yy]$ ]] || { printf 'Aborted.\n'; exit 0; }
fi

cd "$INFRA_DIR"
npm install --prefer-offline 2>/dev/null || npm install

pulumi stack select "$DEPLOY_MODE"
pulumi config set gcp:project "$GCP_PROJECT"
pulumi config set gcp:region  "$GCP_REGION"

_pulumi_destroy_robust() {
  local log_file attempt=0 rc stale_urns
  log_file="$(mktemp)"

  while true; do
    attempt=$(( attempt + 1 ))
    set +e
    pulumi destroy --yes 2>&1 | tee "$log_file"
    rc="${PIPESTATUS[0]}"
    set -e

    [[ "$rc" == "0" ]] && { rm -f "$log_file"; return 0; }

    stale_urns=$(grep -oE 'error: deleting urn:pulumi:[^ ]+' "$log_file" \
      | sed 's/^error: deleting //; s/:$//' | sort -u || true)

    if [[ -z "$stale_urns" ]]; then
      rm -f "$log_file"
      printf '[infra-down] pulumi destroy failed — cannot auto-recover.\n' >&2
      return 1
    fi

    printf '[infra-down] Purging stale state entries (attempt %d)...\n' "$attempt"
    while IFS= read -r urn; do
      [[ -z "$urn" ]] && continue
      pulumi state delete "$urn" --yes 2>/dev/null || true
    done <<< "$stale_urns"
  done
}

_pulumi_destroy_robust

rm -f "$ENV_FILE"
printf '\n[infra-down] Next.js GCP %s resources destroyed.\n' "$DEPLOY_MODE"
