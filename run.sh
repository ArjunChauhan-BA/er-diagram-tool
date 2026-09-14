#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  ERGen — One-click setup & run
# ─────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        ERGen Setup & Launch          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "❌  Python 3 not found. Install from https://python.org"
  exit 1
fi

PYTHON=python3

# Create venv if not exists
if [ ! -d "venv" ]; then
  echo "→  Creating virtual environment..."
  $PYTHON -m venv venv
fi

# Activate
source venv/bin/activate

echo "→  Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "→  Checking Ollama (optional)..."
if curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "✓  Ollama is running"
  MODELS=$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); [print('   •', m['name']) for m in d.get('models',[])]" 2>/dev/null || echo "   (could not list models)")
  echo "$MODELS"
else
  echo "ℹ  Ollama not running — tool will use local parser as fallback."
  echo "   To enable AI mode: install Ollama from https://ollama.com"
  echo "   Then run: ollama pull llama3"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Open http://localhost:5000          ║"
echo "╚══════════════════════════════════════╝"
echo ""

python app.py
