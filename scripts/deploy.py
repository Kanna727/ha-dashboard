#!/usr/bin/env python3
r"""Build the dashboard and push it to Home Assistant by hand.

Releases normally deploy themselves (see .github/workflows/release.yml). Use
this script for config changes, or as a fallback when CI can't reach HA.

1. npm run build -> dist/index.html (generic app) + dist/config.js (your config).
2. Copy them to <HA config>/www/dashboard/ (Samba share by default).
3. Set input_text.dashboard_build = "<version>/<config hash>" so open kiosks reload.

  python scripts/deploy.py                # app + config
  python scripts/deploy.py --config-only  # just config.js (after editing config/dashboard.config.ts)
  python scripts/deploy.py --build-only   # build, don't copy

Env:
  HA_WWW    target dir (default: \\homeassistant.local\config\www\dashboard on Windows,
            /Volumes/config/www/dashboard elsewhere)
  BUILD_DIR local dir to build in (needed on Windows when the repo is on Google Drive)
  HA_URL    e.g. http://homeassistant.local  (for step 3)
  HA_TOKEN  long-lived access token (for step 3; never baked into the build)
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HASH_INPUTS = ["src", "index.html", "package.json", "package-lock.json", "vite.config.ts"]
HELPER = "input_text.dashboard_build"
NPM = "npm.cmd" if os.name == "nt" else "npm"
DEFAULT_TARGET = (
    r"\\homeassistant.local\config\www\dashboard" if os.name == "nt" else "/Volumes/config/www/dashboard"
)


def source_hash() -> str:
    h = hashlib.sha256()
    for name in HASH_INPUTS:
        p = ROOT / name
        files = sorted(f for f in p.rglob("*") if f.is_file()) if p.is_dir() else [p]
        for f in files:
            h.update(str(f.relative_to(ROOT)).encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:12]


def app_version() -> str:
    """Release tag (e.g. 1.4.0), or 1.4.0-3-gabc1234-dirty between releases."""
    try:
        out = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
        return out.removeprefix("v")
    except (OSError, subprocess.CalledProcessError):
        return source_hash()


def stage_build_dir() -> Path:
    """Mirror the sources into BUILD_DIR (a local disk). Google Drive can't host node_modules."""
    dest = Path(os.environ["BUILD_DIR"])
    dest.mkdir(parents=True, exist_ok=True)
    skip = shutil.ignore_patterns("node_modules", "dist", ".git")
    for item in ROOT.iterdir():
        if item.name in ("node_modules", "dist", ".git"):
            continue
        target = dest / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target, ignore=skip)
        else:
            shutil.copyfile(item, target)
    if not (dest / "node_modules").exists():
        subprocess.run([NPM, "install"], cwd=dest, check=True)
    return dest


def build(version: str) -> Path:
    env = {**os.environ, "BUILD_HASH": version}
    env.pop("VITE_MOCK", None)
    work = stage_build_dir() if os.environ.get("BUILD_DIR") else ROOT
    if not (work / "config" / "dashboard.config.ts").exists():
        sys.exit("config/dashboard.config.ts not found; copy config/dashboard.config.example.ts and fill it in")
    subprocess.run([NPM, "run", "build"], cwd=work, env=env, check=True)
    dist = work / "dist"
    if version not in (dist / "index.html").read_text(encoding="utf-8"):
        sys.exit("version missing from bundle; refusing to deploy")
    return dist


def config_hash(dist: Path) -> str:
    m = re.search(r'__DASHBOARD_CONFIG_HASH__="([0-9a-f]+)"', (dist / "config.js").read_text(encoding="utf-8"))
    if not m:
        sys.exit("config hash missing from config.js")
    return m.group(1)


def copy(src: Path, target_dir: Path) -> Path:
    if not target_dir.parent.exists():
        sys.exit(
            f"{target_dir.parent} not found. Mount the HA config share first:\n"
            "  macOS: open smb://homeassistant.local/config\n"
            "  Windows: \\\\homeassistant.local\\config should open in Explorer\n"
            "or set HA_WWW to wherever /config/www is reachable."
        )
    target_dir.mkdir(exist_ok=True)
    dest = target_dir / src.name
    tmp = target_dir / (src.name + ".tmp")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dest)  # atomic swap so a kiosk never loads a half-written file
    return dest


def ha_request(path: str, body: dict | None = None):
    url, token = os.environ.get("HA_URL"), os.environ.get("HA_TOKEN")
    if not (url and token):
        return None
    req = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def current_app_version() -> str | None:
    state = ha_request(f"/api/states/{HELPER}")
    return state["state"].split("/")[0] if state else None


def push_deploy_id(value: str) -> bool:
    return ha_request("/api/services/input_text/set_value", {"entity_id": HELPER, "value": value}) is not None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", default=os.environ.get("HA_WWW", DEFAULT_TARGET))
    ap.add_argument("--build-only", action="store_true", help="build, skip copy and push")
    ap.add_argument("--config-only", action="store_true", help="deploy config.js only, keep the deployed app")
    args = ap.parse_args()

    version = app_version()
    print(f"version {version}")
    dist = build(version)
    cfg = config_hash(dist)
    if args.build_only:
        print(f"built {dist} (config {cfg})")
        return

    target = Path(args.target)
    files = ["config.js"] if args.config_only else ["config.js", "index.html"]
    for name in files:  # config first: the old app ignores it, the new app needs it
        print(f"copied -> {copy(dist / name, target)}")

    if args.config_only:
        version = current_app_version()
        if version is None:
            print(f"HA_URL/HA_TOKEN not set; set {HELPER} to '<deployed version>/{cfg}' to reload kiosks")
            return
    deploy_id = f"{version}/{cfg}"
    if push_deploy_id(deploy_id):
        print(f"{HELPER} = {deploy_id}; kiosks will reload")
    else:
        print(f"HA_URL/HA_TOKEN not set; set {HELPER} to {deploy_id} to reload kiosks")


if __name__ == "__main__":
    main()
