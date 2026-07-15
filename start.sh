#!/usr/bin/env bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'

  Node.js isn't installed.

  1. Go to  https://nodejs.org
  2. Download the big green LTS button, install it
  3. Run this again

MSG
  read -rp "Press enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo
  echo "  First run - installing. This takes a minute, only happens once."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "  Install failed. Check your internet connection and try again."
    read -rp "Press enter to close..."
    exit 1
  fi
fi

node src/server.js
echo
echo "  Stopped."
read -rp "Press enter to close..."
