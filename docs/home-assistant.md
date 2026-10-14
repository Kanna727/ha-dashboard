# Home Assistant setup for automatic deploys

Merging to `main` publishes a release (see the README). To have Home Assistant install each release on its own, set up these pieces once. Nothing here exposes HA to the internet, and GitHub never gets an HA token.

```
GitHub Actions ──(tailnet, tag:ci, port 80 only)──▶ HA webhook {version, url}
                                                     │
                     GitHub release asset ◀──────────┘ Downloader saves www/dashboard/index.html
                                                       then sets input_text.dashboard_build → kiosks reload
```

## 1. Tailscale on Home Assistant

1. Create a free account at [tailscale.com](https://tailscale.com).
2. In HA: **Settings → Apps → App store**, install **Tailscale** (Home Assistant Community Apps), start it, open its web UI and log in.
3. In the [Tailscale admin console](https://login.tailscale.com/admin/machines), note HA's MagicDNS name (for example `homeassistant`). Turn off key expiry for that machine.

## 2. Let CI in (and only to port 80)

In **Access controls**, add a `tag:ci` owner and a rule that lets CI reach HA's web port and nothing else. If your policy is still the default allow-all, replace that rule with the member rule below so `tag:ci` doesn't inherit it.

```jsonc
{
  "tagOwners": { "tag:ci": ["autogroup:admin"] },
  "hosts": { "homeassistant": "100.x.y.z" },      // HA's tailnet IP
  "acls": [
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] },
    { "action": "accept", "src": ["tag:ci"], "dst": ["homeassistant:80"] }
  ]
}
```

Then **Settings → OAuth clients → Generate**, with write access to **Auth Keys** and tag `tag:ci`. CI uses it to join as an ephemeral node that disappears after each run.

## 3. Downloader integration

**Settings → Devices & services → Add integration → Downloader**, download directory `www/dashboard`.

## 4. Deploy automation

Create an automation in YAML mode. Replace the two placeholders:

- `<WEBHOOK_ID>`: a long random string (`python -c "import secrets; print(secrets.token_urlsafe(32))"`). Treat it like a password.
- `<REPO_ID>`: the numeric repository ID (`gh api repos/<owner>/<repo> --jq .id`). The download URL must belong to this repo, so a leaked webhook ID can't be used to plant someone else's file.

```yaml
alias: Dashboard - install release
description: >-
  Called by the GitHub release workflow over Tailscale. Downloads the release's
  index.html into www/dashboard, then updates the build helper so kiosks reload.
mode: queued
triggers:
  - trigger: webhook
    webhook_id: <WEBHOOK_ID>
    allowed_methods: [POST]
    local_only: false # tailnet addresses aren't "local" to HA
conditions:
  - condition: template
    value_template: >-
      {{ trigger.json is defined
         and (trigger.json.version | default('')) is match('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')
         and (trigger.json.url | default('')) is match('^https://[a-z-]+\.githubusercontent\.com/[^/]+/<REPO_ID>/') }}
actions:
  # download_file may block until the file is saved, so listen for the result
  # in parallel; a wait started afterwards would miss the event.
  - parallel:
      - sequence:
          - wait_for_trigger:
              - trigger: event
                event_type: downloader_download_completed
                event_data: { filename: index.html }
              - trigger: event
                event_type: downloader_download_failed
                event_data: { filename: index.html }
            timeout: "00:02:00"
            continue_on_timeout: true
          - if:
              - condition: template
                value_template: "{{ wait.trigger is not none and wait.trigger.event.event_type == 'downloader_download_completed' }}"
            then:
              # Keep the config half of "<version>/<config hash>"; only the app changed.
              - action: input_text.set_value
                target:
                  entity_id: input_text.dashboard_build
                data:
                  value: "{{ trigger.json.version }}/{{ (states('input_text.dashboard_build').split('/'))[1] | default('none') }}"
            else:
              - action: persistent_notification.create
                data:
                  title: Dashboard deploy failed
                  message: "Release v{{ trigger.json.version }} could not be downloaded."
      - sequence:
          - delay: { milliseconds: 500 }
          - action: downloader.download_file
            data:
              url: "{{ trigger.json.url }}"
              filename: index.html
              overwrite: true
```

The helper `input_text.dashboard_build` (max length 64) must exist and already hold `<version>/<config hash>`, and the config must be in HA: do the first deploy with `python scripts/deploy.py` (with `HA_URL` and an admin `HA_TOKEN`), which also creates the hidden `dashboard-config` dashboard that holds your config.

To test without CI, POST the same payload from a machine on your LAN: `{"version": "<x.y.z>", "url": "<signed asset URL>"}` to `http://homeassistant.local/api/webhook/<WEBHOOK_ID>`.

## 5. GitHub secrets

```sh
gh secret set TS_OAUTH_CLIENT_ID
gh secret set TS_OAUTH_SECRET
gh secret set HA_WEBHOOK_ID
gh variable set HA_TAILNET_HOST --body homeassistant   # HA's MagicDNS name
```

To test, run **Actions → Release → Run workflow**: with nothing new to release it redeploys the latest one. A missing secret makes the deploy job skip with a warning instead of failing.
