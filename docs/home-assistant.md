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
  files (index.html and the app-install files) into www/dashboard, then updates
  the build helper so kiosks reload. Accepts {version, url} or
  {version, files: [{name, url}]}.
mode: queued
triggers:
  - trigger: webhook
    webhook_id: <WEBHOOK_ID>
    allowed_methods: [POST]
    local_only: false # tailnet addresses aren't "local" to HA
conditions:
  - condition: template
    value_template: >-
      {%- set allowed = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'] -%}
      {%- set j = trigger.json if trigger.json is defined else {} -%}
      {%- set files = j.files if j.files is defined else [{'name': 'index.html', 'url': j.url | default('')}] -%}
      {{ (j.version | default('')) is match('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')
         and files | count > 0
         and files | map(attribute='name') | reject('in', allowed) | list | count == 0
         and files | map(attribute='url') | reject('match', '^https://[a-z-]+\.githubusercontent\.com/[^/]+/<REPO_ID>/') | list | count == 0 }}
actions:
  - variables:
      files: "{{ trigger.json.files if trigger.json.files is defined else [{'name': 'index.html', 'url': trigger.json.url}] }}"
      failed: false
  - repeat:
      for_each: "{{ files }}"
      sequence:
        # download_file may block until the file is saved, so listen for the
        # result in parallel; a wait started afterwards would miss the event.
        - parallel:
            - sequence:
                - wait_for_trigger:
                    - trigger: event
                      event_type: downloader_download_completed
                    - trigger: event
                      event_type: downloader_download_failed
                  timeout: "00:02:00"
                  continue_on_timeout: true
                - if:
                    - condition: template
                      value_template: "{{ wait.trigger is none or wait.trigger.event.event_type != 'downloader_download_completed' }}"
                  then:
                    - variables: { failed: true } # updates the outer variable
            - sequence:
                - delay: { milliseconds: 500 }
                - action: downloader.download_file
                  data:
                    url: "{{ repeat.item.url }}"
                    filename: "{{ repeat.item.name }}"
                    overwrite: true
  - if:
      - condition: template
        value_template: "{{ not failed }}"
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
          message: "Release v{{ trigger.json.version }}: a file could not be downloaded, so open dashboards were not told to reload."
```

The helper `input_text.dashboard_build` (max length 64) must exist and already hold `<version>/<config hash>`, and the config must be in HA: do the first deploy with `python scripts/deploy.py` (with `HA_URL` and an admin `HA_TOKEN`), which also creates the hidden `dashboard-config` dashboard that holds your config.

To test without CI, POST the same payload from a machine on your LAN: `{"version": "<x.y.z>", "files": [{"name": "index.html", "url": "<signed asset URL>"}]}` to `http://homeassistant.local/api/webhook/<WEBHOOK_ID>`.

## 5. GitHub secrets

```sh
gh secret set TS_OAUTH_CLIENT_ID
gh secret set TS_OAUTH_SECRET
gh secret set HA_WEBHOOK_ID
gh variable set HA_TAILNET_HOST --body homeassistant   # HA's MagicDNS name
```

To test, run **Actions → Release → Run workflow**: with nothing new to release it redeploys the latest one. A missing secret makes the deploy job skip with a warning instead of failing.

## 6. Preview deploys (optional)

Every push to a pull request, and every release, can also install a **preview** at `/local/dashboard/preview/index.html`: the mock dashboard with fake data and the sky test panel, for trying changes on a tablet or phone before merging. It goes through its own automation and webhook, into `www/dashboard/preview/`, so the live dashboard is never touched.

Create a second automation in YAML mode, with a new random `<PREVIEW_WEBHOOK_ID>` and the same `<REPO_ID>`:

```yaml
alias: Dashboard - install preview
description: >-
  Called by the repo's workflows over Tailscale. Downloads the preview build
  (index.html, then version.json) into www/dashboard/preview. Never touches the
  live dashboard or input_text.dashboard_build.
mode: queued
max: 5
triggers:
  - trigger: webhook
    webhook_id: <PREVIEW_WEBHOOK_ID>
    allowed_methods: [POST]
    local_only: false
conditions:
  - condition: template
    value_template: >-
      {%- set allowed = ['index.html', 'version.json'] -%}
      {%- set j = trigger.json if trigger.json is defined else {} -%}
      {%- set files = j.files if j.files is defined else [] -%}
      {{ (j.version | default('')) is match('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')
         and files | count > 0
         and files | map(attribute='name') | reject('in', allowed) | list | count == 0
         and files | map(attribute='url') | reject('match', '^https://[a-z-]+\.githubusercontent\.com/[^/]+/<REPO_ID>/') | list | count == 0 }}
actions:
  - variables:
      files: "{{ trigger.json.files }}"
      failed: false
  - repeat:
      for_each: "{{ files }}"
      sequence:
        - parallel:
            - sequence:
                - wait_for_trigger:
                    - trigger: event
                      event_type: downloader_download_completed
                    - trigger: event
                      event_type: downloader_download_failed
                  timeout: "00:02:00"
                  continue_on_timeout: true
                - if:
                    - condition: template
                      value_template: "{{ wait.trigger is none or wait.trigger.event.event_type != 'downloader_download_completed' }}"
                  then:
                    - variables: { failed: true }
            - sequence:
                - delay: { milliseconds: 500 }
                - action: downloader.download_file
                  data:
                    url: "{{ repeat.item.url }}"
                    subdir: preview
                    filename: "{{ repeat.item.name }}"
                    overwrite: true
  - if:
      - condition: template
        value_template: "{{ failed }}"
    then:
      - action: persistent_notification.create
        data:
          title: Dashboard preview deploy failed
          message: "Preview {{ trigger.json.version }}: a file could not be downloaded."
```

Then store its ID in GitHub:

```sh
gh secret set HA_PREVIEW_WEBHOOK_ID
```

Without that secret the preview jobs skip with a warning. Pull requests from forks never deploy (they get no secrets), so only code pushed to this repo runs on your HA's origin.

## 7. Planner lists and reminder alerts (optional)

The Planner page reads three to-do lists. Add them in Settings → Devices & services:

- **Local To-do**, twice: one list named `Todos` and one named `Reminders` (they become `todo.todos` and `todo.reminders`). Local To-do lists keep due dates, times and notes.
- **Shopping List** (`todo.shopping_list`).

Other names work too: set `PLANNER.todos`, `PLANNER.reminders` and `PLANNER.shopping` in the config. Habits need nothing in Home Assistant: the dashboard keeps them in a hidden dashboard of its own (saving needs an admin login).

**Reminder alerts.** Home Assistant has no trigger for a to-do item coming due, so an automation checks the reminders list once a minute and sends whatever is due that minute. `notify.notify` reaches the phones, and the wall screens show it as an alert (`dashboard: warn` sets its tone):

```yaml
alias: Alert - Reminder due
mode: single
triggers:
  - trigger: time_pattern
    minutes: "/1"
conditions:
  - condition: numeric_state
    entity_id: todo.reminders
    above: 0
actions:
  - action: todo.get_items
    target:
      entity_id: todo.reminders
    data:
      status: needs_action
    response_variable: lists
  - variables:
      due_now: >-
        {% set end = now().replace(second=0, microsecond=0) %}
        {% set ns = namespace(items=[]) %}
        {% for i in lists['todo.reminders']['items'] if i.due is defined and 'T' in i.due %}
          {% set t = as_datetime(i.due) %}
          {% if t is not none and end - timedelta(minutes=1) < t <= end %}
            {% set ns.items = ns.items + [i.summary] %}
          {% endif %}
        {% endfor %}
        {{ ns.items }}
  - repeat:
      for_each: "{{ due_now }}"
      sequence:
        - action: notify.notify
          data:
            title: Reminder
            message: "{{ repeat.item }}"
            data:
              dashboard: warn
```

Reminders with only a date (no time) never alert, and one that came due while Home Assistant was down isn't sent afterwards.

