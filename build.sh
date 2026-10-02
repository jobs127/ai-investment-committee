#!/usr/bin/env bash
# Builds the single-file app from src/:
#   index.html          full document (open locally or serve with GitHub Pages)
#   dist/artifact.html  page fragment for publishing as a claude.ai artifact
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
frag=dist/artifact.html
{
  echo '<title>AI Investment Committee</title>'
  echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">'
  echo '<style>'; cat src/styles.css; echo '</style>'
  cat src/markup.html
  echo '<script>'
  for f in src/core/*.js src/ui/*.js; do echo "/* ---- $f ---- */"; cat "$f"; echo; done
  echo '</script>'
} > "$frag"
if grep -n '</script' src/core/*.js src/ui/*.js >/dev/null; then echo "ERROR: literal </script in source"; exit 1; fi
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="description" content="Nine-plus AI analysts debate a stock in stages and deliver a verdict, expected value and trade plan.">\n</head>\n<body>\n'
  cat "$frag"
  printf '\n</body>\n</html>\n'
} > index.html
echo "built index.html ($(wc -c < index.html) bytes) and $frag"
