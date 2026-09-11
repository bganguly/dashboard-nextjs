#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"
cd "$ROOT_DIR"

_STEP="startup"
_on_exit() { local c=$?; [[ $c -ne 0 ]] && printf '\n[deploy.sh] ABORTED (exit %d) at step: %s\n' "$c" "$_STEP" >&2; }
trap _on_exit EXIT

GCP_PROJECT=""
GCP_REGION="us-central1"
IMAGE=""
SPRING_API_URL=""
ACTIVE_ACCOUNT=""
_TARGET=""
DEPLOY_MODE=""
_local_running=0
_lite_count=0
_full_count=0

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

_shasum() { shasum -a 256 "$@" 2>/dev/null || sha256sum "$@" 2>/dev/null; }

_chk() {
  local n="$1" label="$2" ok="$3" detail="${4:-}"
  if [[ "$ok" == "1" ]]; then
    printf '  [%s] PASS  %s%s\n' "$n" "$label" "${detail:+  ($detail)}"
    _CP=$(( _CP + 1 ))
  else
    printf '  [%s] FAIL  %s%s\n' "$n" "$label" "${detail:+  — $detail}"
    _CF=$(( _CF + 1 ))
  fi
}
_CP=0; _CF=0

lsof -ti:3000 >/dev/null 2>&1 && _local_running=1 || true
if command -v pulumi >/dev/null 2>&1 && pulumi whoami >/dev/null 2>&1; then
  _lite_count=$(_pulumi_stack_count lite)
  _full_count=$(_pulumi_stack_count full)
fi

printf '\n=== dashboard-nextjs ===\n\n'
printf '  [1] Local  — Next.js dev server on localhost:3000 (no GCP cost)'
(( _local_running )) && printf ' [running]' || printf ' [not detected]'
printf '\n'
printf '  [2] Lite   — GCP: Cloud Run (scales to zero, cold starts OK)'
(( _lite_count > 0 )) && printf ' [%s resources active]' "$_lite_count" || printf ' [not deployed]'
printf '\n'
printf '  [3] Full   — GCP: Cloud Run (min 1 instance, always warm)'
(( _full_count > 0 )) && printf ' [%s resources active]' "$_full_count" || printf ' [not deployed]'
printf '\n'

if [[ -n "${DEPLOY_MODE:-}" ]]; then
  _TARGET="remote"
  printf '\n  (DEPLOY_MODE=%s — skipping menu)\n' "$DEPLOY_MODE"
else
  printf '\nChoice [1/2/3]: '
  read -r _MODE
  case "$_MODE" in
    2) _TARGET="remote"; DEPLOY_MODE="lite" ;;
    3) _TARGET="remote"; DEPLOY_MODE="full" ;;
    *) _TARGET="local";  DEPLOY_MODE=""    ;;
  esac
fi

# ══════════════════════════════════════════════════════════════════════════════
# LOCAL
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$_TARGET" == "local" ]]; then
  command -v node >/dev/null 2>&1 || { printf 'Node.js not found — install Node 20+\n' >&2; exit 1; }

  printf '\nInstalling deps...\n'
  npm install --prefer-offline 2>/dev/null || npm install

  printf '\nFreeing port 3000...\n'
  "$ROOT_DIR/scripts/free-port.sh" 3000

  SPRING_API_URL="${SPRING_API_URL:-http://localhost:8080}"
  printf 'Starting Next.js dev server on :3000 (SPRING_API_URL=%s)...\n' "$SPRING_API_URL"
  printf 'Override: SPRING_API_URL=http://other-host:port ./scripts/deploy.sh\n\n'

  SPRING_API_URL="$SPRING_API_URL" npm run dev

  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# REMOTE (GCP)
# ══════════════════════════════════════════════════════════════════════════════

if ! command -v gcloud >/dev/null 2>&1; then
  printf '\ngcloud CLI not found.\n'
  if command -v brew >/dev/null 2>&1; then
    brew install --cask google-cloud-sdk
    source "$(brew --prefix)/share/google-cloud-sdk/path.bash.inc" 2>/dev/null || true
  else
    printf 'Install: https://cloud.google.com/sdk/docs/install\n'; exit 1
  fi
fi

ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 || true)
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  printf '\nNot authenticated — logging in...\n'
  gcloud auth login
  ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 || true)
  [[ -n "$ACTIVE_ACCOUNT" ]] || { printf 'Login failed.\n' >&2; exit 1; }
fi

ENV_FILE="$ROOT_DIR/.env.gcp.${DEPLOY_MODE}"
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

cfg_project=$(gcloud config get-value project 2>/dev/null || true)
GCP_PROJECT="${cfg_project:-${GCP_PROJECT:-}}"
[[ -n "$GCP_PROJECT" ]] || { printf '\nNo GCP project detected. Run: gcloud config set project <id>\n' >&2; exit 1; }

cfg_region=$(gcloud config get-value compute/region 2>/dev/null || true)
GCP_REGION="${cfg_region:-${GCP_REGION:-us-central1}}"

printf 'Auth: %s  Project: %s  Region: %s\n' "$ACTIVE_ACCOUNT" "$GCP_PROJECT" "$GCP_REGION"

# Resolve Spring API URL from the backend's Pulumi output if not set.
if [[ -z "${SPRING_API_URL:-}" ]]; then
  BACKEND_INFRA_DIR="$(cd "$ROOT_DIR/../springboot-dashboard-backend/infra" 2>/dev/null && pwd || true)"
  if [[ -n "$BACKEND_INFRA_DIR" && -d "$BACKEND_INFRA_DIR" ]] && command -v pulumi >/dev/null 2>&1; then
    SPRING_API_URL=$(cd "$BACKEND_INFRA_DIR" && \
      pulumi stack select "$DEPLOY_MODE" 2>/dev/null && \
      pulumi stack output backendUrl 2>/dev/null || true)
  fi
fi
[[ -n "${SPRING_API_URL:-}" ]] || {
  printf '\nCould not resolve backend URL — deploy the backend first, or set SPRING_API_URL.\n' >&2
  exit 1
}
printf 'Backend: %s\n' "$SPRING_API_URL"

NAME_PREFIX=$([[ "$DEPLOY_MODE" == "lite" ]] && printf 'dash-nextjs-lite' || printf 'dash-nextjs-full')
REGISTRY="${NAME_PREFIX}-repo"

_cloudbuild_submit() {
  local tag="$1" project="$2" srcdir="$3"
  gcloud services enable cloudbuild.googleapis.com --project "$project"
  local role
  role=$(gcloud projects get-iam-policy "$project" \
    --flatten="bindings[].members" \
    --filter="bindings.members:user:${ACTIVE_ACCOUNT} AND (bindings.role:roles/cloudbuild OR bindings.role:roles/owner OR bindings.role:roles/editor)" \
    --format="value(bindings.role)" 2>/dev/null | head -1 || true)
  if [[ -z "$role" ]]; then
    printf '  Granting Cloud Build Editor to %s...\n' "$ACTIVE_ACCOUNT"
    gcloud projects add-iam-policy-binding "$project" \
      --member="user:${ACTIVE_ACCOUNT}" --role="roles/cloudbuild.builds.editor" --quiet
  fi
  local cache_tag tmpyaml
  cache_tag="${tag%:*}:cache"
  tmpyaml=$(mktemp /private/tmp/claude-501/-Users-bikram-Personal-interview-prep-grouped-projects-llm-implementations/b97debc2-4f44-439b-a2d6-9311c874335e/scratchpad/cloudbuild.XXXXXX.yaml)
  cat > "$tmpyaml" <<YAML
steps:
- name: 'gcr.io/cloud-builders/docker'
  entrypoint: bash
  args:
  - -c
  - |
    docker pull '${cache_tag}' 2>/dev/null || true
    docker build --cache-from '${cache_tag}' -t '${tag}' -t '${cache_tag}' .
- name: 'gcr.io/cloud-builders/docker'
  args: [push, '${tag}']
- name: 'gcr.io/cloud-builders/docker'
  args: [push, '${cache_tag}']
images:
- '${tag}'
- '${cache_tag}'
YAML
  local attempt=0 rc
  while (( attempt < 3 )); do
    attempt=$(( attempt + 1 ))
    set +e; gcloud builds submit --config "$tmpyaml" --project "$project" "$srcdir"; rc=$?; set -e
    [[ "$rc" == "0" ]] && { rm -f "$tmpyaml"; return 0; }
    [[ "$rc" == "130" ]] && { printf '\n[deploy] Build cancelled.\n'; rm -f "$tmpyaml"; exit 130; }
    (( attempt < 3 )) && { printf '  Cloud Build failed (attempt %d/3) — waiting 20s...\n' "$attempt"; sleep 20; }
  done
  rm -f "$tmpyaml"
  printf '[deploy] Cloud Build failed after 3 attempts.\n' >&2; return 1
}

ar_state=$(gcloud services list --project="$GCP_PROJECT" \
  --filter="name:artifactregistry.googleapis.com" --format="value(state)" 2>/dev/null || true)
[[ "$ar_state" != "ENABLED" ]] && gcloud services enable artifactregistry.googleapis.com --project="$GCP_PROJECT"

if ! gcloud artifacts repositories describe "$REGISTRY" \
    --project="$GCP_PROJECT" --location="$GCP_REGION" >/dev/null 2>&1; then
  printf '  Creating repo "%s"...\n' "$REGISTRY"
  gcloud artifacts repositories create "$REGISTRY" \
    --repository-format=docker --location="$GCP_REGION" --project="$GCP_PROJECT"
fi

TAG=$(find "$ROOT_DIR/app" "$ROOT_DIR/components" "$ROOT_DIR/hooks" \
    "$ROOT_DIR/Dockerfile" "$ROOT_DIR/next.config.ts" "$ROOT_DIR/package.json" \
    -type f 2>/dev/null | sort | xargs cat 2>/dev/null \
  | _shasum | cut -c1-16 || true)
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"

IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REGISTRY}/frontend:${TAG}"

exists=$(gcloud artifacts docker tags list \
  "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REGISTRY}/frontend" \
  --filter="tag=${TAG}" --format="value(tag)" \
  --project "$GCP_PROJECT" 2>/dev/null | head -1 || true)

if [[ -n "$exists" ]]; then
  printf '  Image %s exists — skipping build.\n' "$TAG"
else
  printf '\nBuilding: %s\n' "$IMAGE"
  _STEP="image build"
  _cloudbuild_submit "$IMAGE" "$GCP_PROJECT" "$ROOT_DIR"
fi

gcloud auth application-default print-access-token >/dev/null 2>&1 || {
  printf '  Setting up ADC (required by Pulumi)...\n'
  gcloud auth application-default login
}

_pulumi_up_robust() {
  local log_file attempt=0 rc
  log_file="$(mktemp)"

  while (( attempt < 5 )); do
    attempt=$(( attempt + 1 ))
    set +e; pulumi up --yes 2>&1 | tee "$log_file"; rc="${PIPESTATUS[0]}"; set -e
    [[ "$rc" == "0" ]] && { rm -f "$log_file"; return 0; }

    local conflicts
    conflicts=$(python3 - "${log_file}" <<'PYEOF'
import re, sys
content = open(sys.argv[1]).read()
lines = content.split('\n')
seen = set()
for i, line in enumerate(lines):
    m = re.match(r'\s+(gcp:[^(]+)\(([^)]+)\):', line)
    if m:
        type_display = m.group(1).strip()
        logical_name = m.group(2).strip()
        for j in range(i, min(i+8, len(lines))):
            id_m = re.search(r"'([^']+)' already exists", lines[j])
            if id_m:
                key = f'{type_display}|{logical_name}|{id_m.group(1)}'
                if key not in seen:
                    seen.add(key)
                    print(key)
                break
PYEOF
    2>/dev/null || true)

    if [[ -z "$conflicts" ]]; then
      local stale_urns
      stale_urns=$(grep -oE 'error: deleting urn:pulumi:[^ ]+' "$log_file" \
        | sed 's/^error: deleting //; s/:$//' | sort -u || true)
      if [[ -n "$stale_urns" ]]; then
        printf '[deploy] Purging stale state entries...\n'
        while IFS= read -r urn; do
          [[ -z "$urn" ]] && continue
          pulumi state delete "$urn" --yes 2>/dev/null || true
        done <<< "$stale_urns"
        continue
      fi
      rm -f "$log_file"
      printf '[deploy] pulumi up failed — no importable conflicts.\n' >&2
      grep -E 'error:|Error|failed|FAIL' "$log_file" 2>/dev/null | head -20 >&2 || true
      return 1
    fi

    printf '[deploy] Auto-importing conflicting resources (attempt %d)...\n' "$attempt"
    while IFS='|' read -r type_display logical_name gcp_id; do
      [[ -z "$type_display" ]] && continue
      local module type_name import_type
      module=$(printf '%s' "$type_display" | cut -d: -f2)
      type_name=$(printf '%s' "$type_display" | cut -d: -f3)
      import_type="gcp:${module}/${type_name,}:${type_name}"
      printf '  importing: %s %s = %s\n' "$import_type" "$logical_name" "$gcp_id"
      pulumi import "$import_type" "$logical_name" "$gcp_id" --yes 2>/dev/null || true
    done <<< "$conflicts"
  done

  rm -f "$log_file"
  printf '[deploy] pulumi up failed after %d attempts.\n' "$attempt" >&2
  return 1
}

printf '\n=== deploying via Pulumi ===\n'
_STEP="pulumi up"
cd "$INFRA_DIR"
[[ -d node_modules ]] || npm install --prefer-offline 2>/dev/null || npm install
pulumi stack select "$DEPLOY_MODE" 2>/dev/null || pulumi stack init "$DEPLOY_MODE"
pulumi config set gcp:project      "$GCP_PROJECT"
pulumi config set gcp:region       "$GCP_REGION"
pulumi config set frontendImage    "$IMAGE"
pulumi config set springApiUrl     "$SPRING_API_URL"
if [[ "$DEPLOY_MODE" == "lite" ]]; then
  pulumi config set namePrefix       "dash-nextjs-lite"
  pulumi config set minInstanceCount "0"
  pulumi config set maxInstanceCount "3"
  pulumi config set cpu              "1"
  pulumi config set memory           "512Mi"
else
  pulumi config set namePrefix       "dash-nextjs-full"
  pulumi config set minInstanceCount "1"
  pulumi config set maxInstanceCount "3"
  pulumi config set cpu              "1"
  pulumi config set memory           "512Mi"
fi
_pulumi_up_robust

FRONTEND_URL=$(pulumi stack output frontendUrl 2>/dev/null || true)
cd "$ROOT_DIR"

cat > "$ENV_FILE" <<EOF
GCP_PROJECT=${GCP_PROJECT}
GCP_REGION=${GCP_REGION}
SPRING_API_URL=${SPRING_API_URL}
FRONTEND_URL=${FRONTEND_URL}
EOF

printf '\nFrontend URL: %s\n' "$FRONTEND_URL"

printf '\n=== post-deploy checks ===\n'
_CP=0; _CF=0

http1=$(curl -sf -o /dev/null -w "%{http_code}" "$FRONTEND_URL" --max-time 15 2>/dev/null || echo "000")
[[ "$http1" == "200" ]] && _chk 1 "GET / → 200" 1 "$FRONTEND_URL" || _chk 1 "GET / → 200" 0 "HTTP $http1"

http2=$(curl -sf -o /dev/null -w "%{http_code}" "${FRONTEND_URL}/api/runtime" --max-time 15 2>/dev/null || echo "000")
[[ "$http2" == "200" ]] && _chk 2 "GET /api/runtime → 200 (proxy to backend)" 1 || _chk 2 "GET /api/runtime → 200 (proxy to backend)" 0 "HTTP $http2"

printf '\n  Results: %d passed, %d failed\n' "$_CP" "$_CF"
(( _CF > 0 )) && printf '\n  !! %d CHECK(S) FAILED — review above before presenting\n' "$_CF"

printf '\nRemember to tear down when finished:\n  ./scripts/infra-down.sh\n'
