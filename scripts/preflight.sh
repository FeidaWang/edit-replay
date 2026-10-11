#!/usr/bin/env bash
# Pre-submission checks mirroring the Claude plugin directory's validation.
set -u
cd "$(dirname "$0")/.."
fail=0
bad() { echo "✗ $1"; fail=1; }
ok() { echo "✓ $1"; }

claude plugin validate .claude-plugin/plugin.json 2>&1 | grep -q "✔ Validation passed" && ok "validate plugin + hooks" || bad "validate plugin + hooks"
claude plugin validate .claude-plugin/marketplace.json 2>&1 | grep -q "✔ Validation passed" && ok "validate marketplace" || bad "validate marketplace"
claude plugin test . >/dev/null 2>&1 && ok "claude plugin test" || bad "claude plugin test"

[ -f LICENSE ] && ok "LICENSE present" || bad "LICENSE missing"
words=$(sed '/^```/,/^```/d' README.md 2>/dev/null | wc -w | tr -d ' ')
[ "${words:-0}" -ge 40 ] && ok "README has $words words (>=40)" || bad "README too short"

find . -name .DS_Store -o -name Thumbs.db -o -name desktop.ini -o -name __MACOSX | grep -q . \
  && bad "system files present" || ok "no system files"
find . -type l | grep -q . && bad "symlinks present" || ok "no symlinks"
n=$(find . -type f -not -path './.git/*' | wc -l | tr -d ' ')
[ "$n" -le 512 ] && ok "$n files (<=512)" || bad "too many files: $n"
big=$(find . -type f -not -path './.git/*' -size +256k -not \( -name '*.png' -o -name '*.jpg' -o -name '*.gif' -o -name '*.webp' -o -name '*.woff*' \))
[ -z "$big" ] && ok "no non-image file over 256KiB" || bad "large files: $big"
bin=$(find . -type f -not -path './.git/*' | while read -r f; do file --mime "$f" | grep -qE 'charset=binary' && ! echo "$f" | grep -qiE '\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$' && echo "$f"; done)
[ -z "$bin" ] && ok "no unexpected binary files" || bad "binary files: $bin"
grep -rEn "(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})" --exclude-dir=.git . | grep -q . \
  && bad "possible secret found" || ok "no obvious secrets"
grep -rEn "npx |uvx |bunx " hooks 2>/dev/null | grep -q . && bad "package launcher in hooks" || ok "no package launchers"
exit $fail
