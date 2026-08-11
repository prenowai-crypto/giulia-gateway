#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# upload.sh — Carica un report Markdown come Gist GitHub secret
# ═══════════════════════════════════════════════════════════════════════════
# Uso:
#   ./upload.sh                                     # carica reports/latest-conversations.md
#   ./upload.sh reports/render-2026-08-11.md        # carica file specifico
#   ./upload.sh reports/latest-conversations.md "Test B04"   # con descrizione custom
#
# Setup: metti il token come env variable (una volta per sessione shell):
#   export GITHUB_GIST_TOKEN="ghp_xxx"
#
# Il token si genera in https://github.com/settings/tokens/new con scope 'gist'.
# ═══════════════════════════════════════════════════════════════════════════

set -e

FILE="${1:-reports/latest-conversations.md}"
DESCRIPTION="${2:-Test run $(date +%Y-%m-%d\ %H:%M)}"

if [ -z "$GITHUB_GIST_TOKEN" ]; then
  echo "❌ Env variable GITHUB_GIST_TOKEN non impostata."
  echo "   Crea un token su https://github.com/settings/tokens/new (scope: gist)"
  echo "   Poi: export GITHUB_GIST_TOKEN=\"ghp_...\""
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "❌ File non trovato: $FILE"
  exit 1
fi

FILENAME=$(basename "$FILE")
echo "📤 Uploading $FILE come Gist..."

RESPONSE=$(node -e "
  const fs = require('fs');
  const https = require('https');
  const content = fs.readFileSync('$FILE', 'utf-8');
  const body = JSON.stringify({
    description: '$DESCRIPTION',
    public: false,
    files: { '$FILENAME': { content } }
  });
  const req = https.request({
    method: 'POST',
    hostname: 'api.github.com',
    path: '/gists',
    headers: {
      'Authorization': 'token $GITHUB_GIST_TOKEN',
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'render-test-uploader',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.html_url) console.log(json.html_url);
        else console.error('Errore API:', json.message || data);
      } catch (e) {
        console.error('Risposta non-JSON:', data.substring(0, 200));
      }
    });
  });
  req.on('error', e => console.error('Errore rete:', e.message));
  req.write(body);
  req.end();
")

if [[ "$RESPONSE" == https://gist.github.com/* ]]; then
  echo ""
  echo "✅ Gist creato:"
  echo "   $RESPONSE"
  echo ""
  echo "   Apri nel browser per leggere/scaricare."
else
  echo ""
  echo "❌ Errore: $RESPONSE"
  exit 1
fi
