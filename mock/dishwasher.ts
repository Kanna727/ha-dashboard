import type { HassEntity } from 'home-assistant-js-websocket';

// The dishwasher in the mock behaves like the real Home Connect one, so the
// modal's controls can be tried: Start runs the selected program (or waits
// out a delayed start), progress and finish time move on their own, Stop goes
// aborting -> ready, and the power switch takes it to inactive and back.
// A minute of a cycle started here passes in a second, so a run can be
// watched end to end. (The fixtures' own mid-cycle stays still: other screens
// and screenshots rely on it.)

type Patch = (id: string, p: { state?: string; attributes?: Record<string, unknown> }) => void;

const STATE = 'sensor.utility_dishwasher_operation_state';
const PROGRESS = 'sensor.dishwasher_program_progress';
const FINISH = 'sensor.dishwasher_program_finish_time';
const SELECTED = 'select.utility_dishwasher_selected_program';
const ACTIVE = 'select.utility_dishwasher_active_program';
const STOP = 'button.dishwasher_stop_program';
const POWER = 'switch.utility_dishwasher_power';
const SPEED = 60; // mock seconds per real second

// Program lengths in minutes.
const MINUTES: Record<string, number> = { eco_50: 195, auto_2: 140, intensiv_power: 160, quick_65: 60, quick_45: 30, pre_rinse: 15, night_wash: 220 };

let timer = 0;

// The running cycle: progress from the time left, finish at 100 %.
function tick(patch: Patch, get: (id: string) => HassEntity | undefined) {
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    const op = get(STATE)?.state;
    const finish = new Date(get(FINISH)?.state ?? '').getTime();
    const total = Number(get(PROGRESS)?.attributes.mock_total ?? 0);
    if (!Number.isFinite(finish) || !total) return window.clearInterval(timer);
    // Mock time runs SPEED times faster: pull the finish time in to match.
    const next = finish - (SPEED - 1) * 1000;
    patch(FINISH, { state: new Date(next).toISOString() });
    const leftMs = next - Date.now();
    if (op === 'delayedstart') {
      if (leftMs <= total * 60_000) patch(STATE, { state: 'run' });
      return;
    }
    if (op !== 'run') return window.clearInterval(timer);
    const pct = Math.min(100, Math.max(1, Math.round(100 - (leftMs / (total * 60_000)) * 100)));
    patch(PROGRESS, { state: String(pct) });
    if (pct >= 100) {
      patch(STATE, { state: 'finished' });
      window.clearInterval(timer);
    }
  }, 1000);
}

export function dishwasherService(
  domain: string,
  service: string,
  data: Record<string, unknown>,
  ids: string[],
  patch: Patch,
  get: (id: string) => HassEntity | undefined,
): boolean {
  if (domain === 'home_connect' && service === 'start_selected_program') {
    const program = get(SELECTED)?.state ?? '';
    const total = MINUTES[program.replace('dishcare_dishwasher_program_', '')] ?? 120;
    const delayS = Number(data.b_s_h_common_option_start_in_relative ?? 0);
    patch(ACTIVE, { state: program });
    patch(PROGRESS, { state: delayS ? '0' : '1', attributes: { mock_total: total } });
    patch(FINISH, { state: new Date(Date.now() + (delayS + total * 60) * 1000).toISOString() });
    patch(STATE, { state: delayS ? 'delayedstart' : 'run' });
    tick(patch, get);
    return true;
  }
  if (domain === 'button' && ids.includes(STOP)) {
    window.clearInterval(timer);
    patch(STATE, { state: 'aborting' });
    window.setTimeout(() => {
      patch(PROGRESS, { state: '0' });
      patch(STATE, { state: 'ready' });
    }, 2500);
    return true;
  }
  if (domain === 'switch' && ids.includes(POWER) && (service === 'turn_on' || service === 'turn_off')) {
    patch(POWER, { state: service === 'turn_on' ? 'on' : 'off' });
    patch(STATE, { state: service === 'turn_on' ? 'ready' : 'inactive' });
    return true;
  }
  return false;
}
