#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="${ROOT}/dist/native/macos/mic-tool-ts-input-helper"

if [[ ! -x "${HELPER}" ]]; then
  echo "Missing helper binary: ${HELPER}" >&2
  echo "Build mic-tool-ts before running this smoke script." >&2
  exit 1
fi

PAYLOAD="${1:-Focused input helper smoke test.}"

echo "== diagnose =="
"${HELPER}" diagnose

echo
echo "Focus the target input control now. Press Return to send the smoke payload." >&2
read -r _

printf '%s' "${PAYLOAD}" | "${HELPER}" send --method auto
