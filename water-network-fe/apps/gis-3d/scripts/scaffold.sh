#!/usr/bin/env bash
#
# Scaffold a new frontend service from this template.
#
# Usage:
#   ./scripts/scaffold.sh <service-name> [target-directory]
#
# Example:
#   ./scripts/scaffold.sh my-service ../my-service
#
set -euo pipefail

SERVICE_NAME="${1:?Usage: scaffold.sh <service-name> [target-directory]}"
TARGET_DIR="${2:-../${SERVICE_NAME}}"
TEMPLATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Normalize service name
KEBAB_NAME=$(echo "$SERVICE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

echo "=== Scaffolding frontend service: ${KEBAB_NAME} ==="
echo "Template: ${TEMPLATE_DIR}"
echo "Target:   ${TARGET_DIR}"
echo ""

if [ -d "${TARGET_DIR}" ] && [ "$(ls -A "${TARGET_DIR}" 2>/dev/null)" ]; then
  echo "ERROR: Target directory ${TARGET_DIR} exists and is not empty."
  exit 1
fi

mkdir -p "${TARGET_DIR}"

# Copy template files (excluding internal files)
rsync -a \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.eslintcache' \
  --exclude='.beads' \
  --exclude='.claude' \
  --exclude='bun.lock' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  "${TEMPLATE_DIR}/" "${TARGET_DIR}/"

# Remove template-specific sample files
rm -rf "${TARGET_DIR}/docs/migration-solid"
rm -rf "${TARGET_DIR}/docs/migrations"
rm -f "${TARGET_DIR}/docs/project-scan-report.json"
rm -f "${TARGET_DIR}/docs/migrations/template-v1.1.0.md"
rm -f "${TARGET_DIR}/docs/migrations/template-v1.0.0.md"

# Update package.json with service name
if command -v sed &>/dev/null; then
  sed -i.bak "s/\"name\": \"frontend-sample\"/\"name\": \"${KEBAB_NAME}\"/" "${TARGET_DIR}/package.json"
  sed -i.bak "s/\"Frontend Sample\"/\"${KEBAB_NAME}\"/g" "${TARGET_DIR}/.env.example"
  rm -f "${TARGET_DIR}/package.json.bak" "${TARGET_DIR}/.env.example.bak"
fi

# Copy .env.example as .env
cp "${TARGET_DIR}/.env.example" "${TARGET_DIR}/.env"

# Update VITE_APP_NAME in .env
if command -v sed &>/dev/null; then
  sed -i.bak "s/VITE_APP_NAME=\"Frontend Sample\"/VITE_APP_NAME=\"${KEBAB_NAME}\"/" "${TARGET_DIR}/.env"
  rm -f "${TARGET_DIR}/.env.bak"
fi

echo ""
echo "=== Scaffold complete ==="
echo ""
echo "Next steps:"
echo "  1. cd ${TARGET_DIR}"
echo "  2. npm install"
echo "  3. Update .env with your service configuration (API URL, Keycloak, etc.)"
echo "  4. Remove sample pages/entities/features you don't need"
echo "  5. npm run dev"
echo ""
echo "Template version: $(node -p 'require("./package.json").version' 2>/dev/null || echo 'unknown')"
