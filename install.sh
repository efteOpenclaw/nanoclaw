#!/usr/bin/env bash
# install.sh — set up Okti (nanoclaw-based assistant)
#
# Raw install (no personal config):
#   bash install.sh
#
# Personal install (applies your private overlay):
#   bash install.sh --personal
#
# Or pipe from GitHub:
#   curl -sL https://raw.githubusercontent.com/efteOpenclaw/nanoclaw/main/install.sh | bash
#   curl -sL https://raw.githubusercontent.com/efteOpenclaw/nanoclaw/main/install.sh | bash -s -- --personal
set -euo pipefail

PERSONAL=false
INSTALL_DIR="$HOME/nanoclaw"
REPO="https://github.com/efteOpenclaw/nanoclaw.git"
PERSONAL_REPO="https://github.com/efteOpenclaw/nanoclaw-personal.git"

for arg in "$@"; do
  [[ "$arg" == "--personal" ]] && PERSONAL=true
done

echo ""
echo "=== Okti / NanoClaw installer ==="
echo "Mode: $([ "$PERSONAL" = true ] && echo 'personal' || echo 'raw')"
echo "Target: $INSTALL_DIR"
echo ""

# --- Prerequisites ---
for cmd in git node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is required but not installed."
    exit 1
  fi
done

# --- Clone or update ---
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Existing install found — pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning nanoclaw..."
  git clone "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# --- Dependencies ---
echo "Installing dependencies..."
npm install --silent

# --- Build ---
echo "Building..."
npm run build --silent

# --- Personal overlay ---
if [[ "$PERSONAL" = true ]]; then
  PERSONAL_DIR="$HOME/nanoclaw-personal"
  if [[ ! -d "$PERSONAL_DIR/.git" ]]; then
    echo "Cloning personal config overlay..."
    git clone "$PERSONAL_REPO" "$PERSONAL_DIR"
  else
    echo "Updating personal config overlay..."
    git -C "$PERSONAL_DIR" pull --ff-only
  fi
  bash "$PERSONAL_DIR/apply.sh" "$INSTALL_DIR"
else
  # Raw mode — write a minimal .env if none exists
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    echo ""
    echo "Wrote .env from .env.example — edit it before starting:"
    echo "  $INSTALL_DIR/.env"
  fi
fi

echo ""
echo "=== Install complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env — set your bot token and API credentials"
echo "  2. cd $INSTALL_DIR && npm run dev"
echo ""
