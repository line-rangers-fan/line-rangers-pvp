#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

# The primary PvP repository stays private and its Pages site stays disabled.
# The review build must therefore use the tracked public/pvp surface and its
# validated same-origin snapshot. Never reintroduce anonymous codeload/raw
# access to the private primary repository as a build dependency.
for required in \
  "${SITES_PROJECT_ROOT}/public/pvp/index.html" \
  "${SITES_PROJECT_ROOT}/public/pvp/assets/style.css" \
  "${SITES_PROJECT_ROOT}/public/pvp/assets/app.js" \
  "${SITES_PROJECT_ROOT}/public/pvp/data/character_usage.json"; do
  if [[ ! -s "${required}" ]]; then
    echo "Required PvP review asset is missing: ${required}" >&2
    exit 66
  fi
done

echo "Building PvP-first Owner review application..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build
