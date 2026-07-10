#!/usr/bin/env bash
# Publish this Skill Hub catalog into a local agentregistry daemon.
#
# Thin wrapper: prefers agentregistry's publisher when that repo is present,
# otherwise posts directly to the legacy /v0/skills API using catalog.json.
#
# Usage:
#   ./scripts/publish-to-agentregistry.sh
#   ./scripts/publish-to-agentregistry.sh --limit 10 --dry-run
#   REGISTRY_URL=http://localhost:12121 ./scripts/publish-to-agentregistry.sh --prefix solana

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SKILLHUB_DIR="$ROOT"
REGISTRY_URL="${REGISTRY_URL:-${ARCTL_API_BASE_URL:-http://localhost:12121}}"

CANDIDATES=(
  "${AGENTREGISTRY_DIR:-}"
  "$HOME/agentregistry-main"
  "$HOME/agentregistry"
  "/Users/8bit/agentregistry-main"
  "$ROOT/../agentregistry-main"
  "$ROOT/../agentregistry"
)

for d in "${CANDIDATES[@]}"; do
  [[ -z "$d" ]] && continue
  if [[ -x "$d/scripts/publish-skillhub-skills.sh" ]]; then
    echo "Using agentregistry publisher: $d/scripts/publish-skillhub-skills.sh"
    exec env SKILLHUB_DIR="$ROOT" REGISTRY_URL="$REGISTRY_URL" \
      "$d/scripts/publish-skillhub-skills.sh" "$@"
  fi
done

echo "agentregistry publisher not found; using built-in legacy POST path."
echo "  (Clone agentregistry next to this repo, or set AGENTREGISTRY_DIR=...)"
echo ""

# Minimal built-in publisher so skillhub works standalone.
DRY_RUN=0
LIMIT=0
PREFIXES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --limit) LIMIT="${2:?}"; shift 2 ;;
    --prefix) PREFIXES+=("$2"); shift 2 ;;
    --registry-url) REGISTRY_URL="${2:?}"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$ROOT/catalog.json" ]]; then
  echo "ERROR: $ROOT/catalog.json missing. Run: npm run build:catalog" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  if ! curl -fsS "$REGISTRY_URL/v0/skills?limit=1" >/dev/null 2>&1; then
    echo "ERROR: registry not reachable at $REGISTRY_URL (try: arctl daemon start)" >&2
    exit 1
  fi
fi

export REGISTRY_URL LIMIT DRY_RUN
export PREFIXES_CSV
PREFIXES_CSV="$(IFS=,; echo "${PREFIXES[*]:-}")"

python3 - <<'PY'
import json, os, re, hashlib, urllib.request, urllib.error
from pathlib import Path

root = Path(os.environ["SKILLHUB_DIR"])
registry = os.environ["REGISTRY_URL"].rstrip("/")
limit = int(os.environ.get("LIMIT") or 0)
dry = os.environ.get("DRY_RUN") == "1"
prefixes = [p for p in (os.environ.get("PREFIXES_CSV") or "").split(",") if p]
repo_url = "https://github.com/Solizardking/skills"

items = json.loads((root / "catalog.json").read_text())

def dns_name(slug: str) -> str:
    name = slug.lower().replace("/", "-").replace("_", "-")
    name = re.sub(r"[^a-z0-9.-]+", "-", name)
    name = re.sub(r"-{2,}", "-", name).strip("-.")
    if not name:
        name = "skill"
    if not name[0].isalnum():
        name = "s-" + name
    if not name[-1].isalnum():
        name = name + "0"
    if len(name) > 63:
        digest = hashlib.sha1(slug.encode()).hexdigest()[:8]
        name = name[:54].rstrip("-.") + "-" + digest
    return name

selected = []
for item in items:
    slug = (item.get("slug") or "").strip()
    if not slug:
        continue
    if prefixes and not any(slug == p or slug.startswith(p.rstrip("/") + "/") or slug.startswith(p) for p in prefixes):
        continue
    selected.append(item)
if limit > 0:
    selected = selected[:limit]

print(f"Publishing {len(selected)} skills → {registry}")
ok = err = 0
for item in selected:
    slug = item["slug"]
    name = dns_name(slug)
    payload = {
        "name": name,
        "version": "1.0.0",
        "title": (item.get("name") or slug.split("/")[-1])[:200],
        "description": (item.get("description") or f"Skill: {slug}")[:2000].replace("\n", " "),
        "category": item.get("category") or "Uncategorized",
        "repository": {"url": repo_url, "source": "github"},
    }
    print(f"  {name:50s}", end=" ", flush=True)
    if dry:
        print("(dry-run)")
        ok += 1
        continue
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{registry}/v0/skills",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
        print("✓")
        ok += 1
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if e.code == 409 or "duplicate version" in body.lower() or "already exists" in body.lower():
            print("· exists")
            ok += 1
        else:
            print(f"✗ HTTP {e.code}: {body[:160]}")
            err += 1
    except Exception as e:
        print(f"✗ {e}")
        err += 1

print(f"\nDone. ok={ok} err={err}")
raise SystemExit(1 if err else 0)
PY
