#!/bin/bash
# Batch register all skills from this repo into the Google Cloud Skill Registry.
# Prerequisites:
#   - GCP_PROJECT_ID env var set (or pass via --project)
#   - gcloud auth application-default login completed
#   - python3 with google-auth and requests installed
#
# Usage:
#   ./scripts/register-all-skills.sh                  # uses env vars
#   ./scripts/register-all-skills.sh --project x402-477302 --location us-central1
#   ./scripts/register-all-skills.sh --project x402-477302 --location us-central1 --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CATALOG="$REPO_ROOT/catalog.json"

PROJECT="${GCP_PROJECT_ID:-}"
LOCATION="${GCP_LOCATION:-us-central1}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
fi

if [[ -z "$PROJECT" ]]; then
  echo "ERROR: GCP_PROJECT_ID not set. Provide --project or set GCP_PROJECT_ID env var."
  exit 1
fi

echo "========================================"
echo "  Skill Registry Batch Upload"
echo "  Project:   $PROJECT"
echo "  Location:  $LOCATION"
echo "  Dry Run:   $DRY_RUN"
echo "========================================"
echo ""

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but not found."
  exit 1
fi

echo "Checking authentication..."
TOKEN="$(gcloud auth application-default print-access-token 2>/dev/null || true)"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: No valid auth token. Run: gcloud auth application-default login"
  exit 1
fi
echo "Authentication OK."
echo ""

# Generate a JSON list of skill entries using Python for proper JSON handling
SKILLS_JSON=$(python3 << 'PYEOF'
import json, sys

with open('CATALOG_PLACEHOLDER') as f:
    catalog = json.load(f)

entries = []
for s in catalog:
    slug = s['slug']
    name = s['name']
    desc = s['description']

    skill_id = slug.replace('/', '-').replace('_', '-').lower()
    if skill_id.startswith('gcp-'):
        skill_id = 'x-' + skill_id
    if not skill_id[0].isalpha():
        skill_id = 's-' + skill_id

    entries.append({
        'slug': slug,
        'skill_id': skill_id,
        'name': name,
        'description': desc,
    })

print(json.dumps(entries))
PYEOF
)

# Replace placeholder with actual catalog path
SKILLS_JSON=$(python3 -c "
import json
with open('$CATALOG') as f:
    catalog = json.load(f)

entries = []
for s in catalog:
    slug = s['slug']
    name = s['name']
    desc = s['description']

    skill_id = slug.replace('/', '-').replace('_', '-').lower()
    if skill_id.startswith('gcp-'):
        skill_id = 'x-' + skill_id
    if not skill_id[0].isalpha():
        skill_id = 's-' + skill_id

    entries.append({
        'slug': slug,
        'skill_id': skill_id,
        'name': name,
        'description': desc,
    })

print(json.dumps(entries))
")

TOTAL=$(echo "$SKILLS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "Found $TOTAL skills in catalog."
echo ""

# Process each skill using a temp file to avoid subshell issues
echo "$SKILLS_JSON" > /tmp/skills_batch.json

SUCCESS=0
SKIPPED=0
FAILED=0
INDEX=0

while IFS= read -r line; do
  INDEX=$((INDEX + 1))

  SLUG=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['slug'])")
  SKILL_ID=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['skill_id'])")
  NAME=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
  DESC=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['description'])")

  SRC_DIR="$REPO_ROOT/$SLUG"

  echo "[$INDEX/$TOTAL] $SLUG"

  if [[ ! -d "$SRC_DIR" ]]; then
    echo "  SKIP - source directory not found"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ ! -f "$SRC_DIR/SKILL.md" ]]; then
    echo "  SKIP - no SKILL.md found"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  DRY-RUN: would upload as skill_id=$SKILL_ID"
    SUCCESS=$((SUCCESS + 1))
    continue
  fi

  # Create zip of the skill directory
  TEMP_ZIP=$(mktemp)
  (cd "$SRC_DIR" && zip -r "$TEMP_ZIP" . -x ".DS_Store" "node_modules/*" ".git/*" >/dev/null 2>&1)
  ZIP_SIZE=$(stat -f%z "$TEMP_ZIP" 2>/dev/null || stat -c%s "$TEMP_ZIP" 2>/dev/null || echo "unknown")
  echo "  zip size: $ZIP_SIZE bytes"

  # Build the payload and call the API using Python for proper JSON handling
  HTTP_CODE=$(python3 -c "
import json, base64, urllib.request

with open('$TEMP_ZIP', 'rb') as f:
    zip_bytes = f.read()
b64 = base64.b64encode(zip_bytes).decode('utf-8')

payload = json.dumps({
    'displayName': '''$NAME''',
    'description': '''$DESC''',
    'zippedFilesystem': b64,
}).encode('utf-8')

url = f'https://$LOCATION-aiplatform.googleapis.com/v1beta1/projects/$PROJECT/locations/$LOCATION/skills?skillId=$SKILL_ID'
req = urllib.request.Request(url, data=payload, method='POST')
req.add_header('Authorization', 'Bearer $TOKEN')
req.add_header('Content-Type', 'application/json')

try:
    resp = urllib.request.urlopen(req)
    print(resp.status)
except urllib.error.HTTPError as e:
    print(f'ERR:{e.code}:{e.read().decode(\"utf-8\")[:200]}')
except urllib.error.URLError as e:
    print(f'ERR:0:{str(e)}')
" 2>&1)

  rm -f "$TEMP_ZIP"

  if echo "$HTTP_CODE" | grep -q '^200\|^201'; then
    echo "  CREATED (HTTP $HTTP_CODE)"
    SUCCESS=$((SUCCESS + 1))
  elif echo "$HTTP_CODE" | grep -q '^ERR:409'; then
    echo "  Already exists, updating..."
    UPDATE_HTTP_CODE=$(python3 -c "
import json, base64, urllib.request

with open('$TEMP_ZIP', 'rb') as f:
    zip_bytes = f.read()
b64 = base64.b64encode(zip_bytes).decode('utf-8')

payload = json.dumps({
    'displayName': '''$NAME''',
    'description': '''$DESC''',
    'zippedFilesystem': b64,
}).encode('utf-8')

url = f'https://$LOCATION-aiplatform.googleapis.com/v1beta1/projects/$PROJECT/locations/$LOCATION/skills/$SKILL_ID?updateMask=displayName,description,zippedFilesystem'
req = urllib.request.Request(url, data=payload, method='PATCH')
req.add_header('Authorization', 'Bearer $TOKEN')
req.add_header('Content-Type', 'application/json')

try:
    resp = urllib.request.urlopen(req)
    print(resp.status)
except urllib.error.HTTPError as e:
    print(f'ERR:{e.code}:{e.read().decode(\"utf-8\")[:200]}')
except urllib.error.URLError as e:
    print(f'ERR:0:{str(e)}')
" 2>&1)

    if echo "$UPDATE_HTTP_CODE" | grep -q '^200'; then
      echo "  UPDATED (HTTP $UPDATE_HTTP_CODE)"
      SUCCESS=$((SUCCESS + 1))
    else
      echo "  UPDATE FAILED: $UPDATE_HTTP_CODE"
      FAILED=$((FAILED + 1))
    fi
  elif echo "$HTTP_CODE" | grep -q '^ERR:'; then
    echo "  FAILED: $HTTP_CODE"
    FAILED=$((FAILED + 1))
  else
    echo "  FAILED (HTTP $HTTP_CODE)"
    FAILED=$((FAILED + 1))
  fi

done < <(python3 -c "
import json
with open('/tmp/skills_batch.json') as f:
    entries = json.load(f)
for e in entries:
    print(json.dumps(e))
")

rm -f /tmp/skills_batch.json

echo ""
echo "========================================"
echo "  Summary"
echo "  Project:  $PROJECT"
echo "  Location: $LOCATION"
echo "  Total:    $TOTAL"
echo "  Success:  $SUCCESS"
echo "  Skipped:  $SKIPPED"
echo "  Failed:   $FAILED"
echo "========================================"