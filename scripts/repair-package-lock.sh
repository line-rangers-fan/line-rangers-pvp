#!/usr/bin/env bash
set -euo pipefail
lockfile="${1:-package-lock.json}"
[[ -f package.json ]] || { echo 'Missing package.json' >&2; exit 66; }

valid_json(){ [[ -f "$1" ]] && node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'))" "$1" >/dev/null 2>&1; }

if [[ -f "${lockfile}" ]] && valid_json "${lockfile}"; then
  exit 0
fi

# Some imported copies accidentally captured the UI's "truncated output"
# markers around an otherwise real lockfile. First try the lossless prefix
# repair; if another marker exists inside the file, regenerate from package.json
# rather than attempting to guess or splice dependency metadata.
if [[ -f "${lockfile}" ]] && [[ "$(head -n 1 "${lockfile}")" == "Warning: truncated output (original token count:"* ]]; then
  tmp="${lockfile}.repair.$$"
  tail -n +4 "${lockfile}" > "${tmp}"
  if valid_json "${tmp}"; then
    mv "${tmp}" "${lockfile}"
    echo '[sites] repaired imported package-lock prefix'
    exit 0
  fi
  rm -f "${tmp}"
fi

echo '[sites] imported package-lock is not valid JSON; regenerating it from package.json'
rm -f "${lockfile}"
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
valid_json "${lockfile}" || { echo 'Regenerated package-lock is invalid.' >&2; exit 65; }
echo '[sites] regenerated a valid package-lock for this build'
