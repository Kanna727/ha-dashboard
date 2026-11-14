#!/bin/sh
# Tests scripts/privacy-check.sh in a throwaway git repo: things that must be
# blocked, and fictional examples that must pass. Run: sh scripts/privacy-check.test.sh
set -eu
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q .
mkdir scripts
cp "$root/scripts/privacy-check.sh" "$root/scripts/privacy-generic.patterns" scripts/
git config user.email t@example.com
git config user.name t
unset PRIVACY_PATTERNS || true
failures=0

# $1 = name, $2 = expected exit (0 pass, 1 blocked), $3 = file name, $4 = file content
check() {
  rm -rf src && mkdir src
  printf '%s\n' "$4" > "src/$3"
  git add -A >/dev/null 2>&1
  code=0
  sh scripts/privacy-check.sh --staged >/dev/null 2>&1 || code=$?
  if [ "$code" != "$2" ]; then echo "FAIL: $1 (exit $code, wanted $2)"; failures=$((failures + 1)); else echo "ok:   $1"; fi
}

# Secrets are assembled at run time so this file never contains a real-looking one.
check "google api key"   1 a.ts "const k = '$(printf 'AI''za')SyA1234567890abcdefghijklmnopqrstuv';"
check "github token"     1 a.ts "t = '$(printf 'gh''p_')abcdefghijklmnopqrstuvwxyz0123456789'"
check "private key"      1 a.ts "$(printf -- '-----BEGIN RSA PRIVATE ''KEY-----')"
check "webhook id"       1 a.ts "post('/api/webhook/abcdEFGH1234ijklMNOP')"
check "rtsp credentials" 1 a.ts "url = 'rtsp://admin:hunter2@camera.lan/stream'"
check "real email"       1 a.ts "owner = 'person@mailbox.test'"
check "lan ip"           1 a.ts "host = '192.168.7.20'"
check "10.x ip"          1 a.ts "host = '10.1.2.3'"
check "tailscale ip"     1 a.ts "host = '100.101.102.103'"
check "real mac"         1 a.ts "mac = '0c:4e:a0:30:2d:ac'"
check ".env file"        1 .env "X=1"
check "local file"       1 notes.local.html "<p>x</p>"
check "3d model"         1 car.glb "x"
check "example email"    0 a.ts "to = 'claims@example.com'"
check "noreply email"    0 a.ts "a = '1+user@users.noreply.github.com'"
check "fictional mac"    0 a.ts "mac = '02:00:5e:00:00:01'"
check "test-net ip"      0 a.ts "ip = '192.0.2.5'"
check "ok marker"        0 a.ts "host = '192.168.1.9' // privacy-check: ok"
check "plain code"       0 a.ts "const a = 1; // version 1.2.3.4"

# Private patterns: from the environment.
rm -rf src && mkdir src && echo "secret-name here" > src/a.ts && git add -A >/dev/null
code=0; PRIVACY_PATTERNS='secret-name' sh scripts/privacy-check.sh --staged >/dev/null 2>&1 || code=$?
if [ "$code" != 1 ]; then echo "FAIL: private pattern (exit $code)"; failures=$((failures + 1)); else echo "ok:   private pattern"; fi

[ "$failures" = 0 ] && echo "all privacy-check tests passed" || { echo "$failures failed"; exit 1; }
