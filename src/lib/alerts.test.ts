import { describe, expect, it } from 'vitest';
import { cycleEnded, isResolved, mirrorsService, noticeFrom, overdueDoors } from './alerts';

describe('cycle ended', () => {
  it('fires only on a seen running -> stopped transition', () => {
    expect(cycleEnded(true, false)).toBe(true);
    expect(cycleEnded(true, true)).toBe(false);
    expect(cycleEnded(false, false)).toBe(false);
    expect(cycleEnded(undefined, false)).toBe(false); // first reading after load
  });
});

describe('overdue doors', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const min = 60_000;

  it('flags doors open longer than the limit, once per open episode', () => {
    const doors = [
      { id: 'binary_sensor.front', open: true, since: now - 5 * min },
      { id: 'binary_sensor.fridge', open: true, since: now - 1 * min },
      { id: 'binary_sensor.back', open: false, since: now - 30 * min },
    ];
    const first = overdueDoors(doors, now, 3, new Set());
    expect(first).toEqual([{ id: 'binary_sensor.front', key: `binary_sensor.front@${now - 5 * min}`, openMin: 5 }]);
    expect(overdueDoors(doors, now, 3, new Set([first[0].key]))).toEqual([]);
  });

  it('treats a reopen as a new episode', () => {
    const alerted = new Set([`binary_sensor.front@${now - 20 * min}`]);
    expect(overdueDoors([{ id: 'binary_sensor.front', open: true, since: now - 4 * min }], now, 3, alerted)).toHaveLength(1);
  });
});

describe('mirrored notify services', () => {
  const patterns = ['notify', 'mobile_app_*'];
  it('matches exact names and prefixes', () => {
    expect(mirrorsService('notify', patterns)).toBe(true);
    expect(mirrorsService('mobile_app_pixel_9', patterns)).toBe(true);
    expect(mirrorsService('tv', patterns)).toBe(false);
    expect(mirrorsService('notify', [])).toBe(false);
  });
});

describe('notice from a notify call', () => {
  it('uses the message as the title when there is none, and lifts the emoji out', () => {
    expect(noticeFrom({ message: 'Laundry is done! 🧺' })).toEqual({ title: 'Laundry is done!', text: undefined, emoji: '🧺', tone: 'ok' });
    expect(noticeFrom({ message: '🍽️ Dishwasher cycle completed!' })).toMatchObject({ title: 'Dishwasher cycle completed!', emoji: '🍽️' });
    expect(noticeFrom({ message: 'Common Bathroom Geyser turned off — water is hot! ♨️' })).toMatchObject({
      title: 'Common Bathroom Geyser turned off — water is hot!',
      emoji: '♨️',
    });
  });

  it('puts the message under a title', () => {
    expect(noticeFrom({ title: 'Laundry Reminder 🧺', message: 'Clean laundry has been waiting for 40 minutes!' })).toEqual({
      title: 'Laundry Reminder',
      text: 'Clean laundry has been waiting for 40 minutes!',
      emoji: '🧺',
      tone: 'ok',
    });
    expect(noticeFrom({ title: 'Shoe Rack', message: 'A shoe rack door was opened.' })).toMatchObject({ title: 'Shoe Rack', emoji: undefined });
  });

  it('marks warnings by emoji or wording', () => {
    expect(noticeFrom({ message: '⚠️ Fridge door has been left open for 2 minutes!' })?.tone).toBe('warn');
    expect(noticeFrom({ message: 'Your car is unlocked' })?.tone).toBe('warn');
  });

  it('keeps ZWJ emoji whole', () => {
    expect(noticeFrom({ message: 'Dinner is ready 👩‍🍳' })?.emoji).toBe('👩‍🍳');
  });

  it('skips empty messages and companion-app commands', () => {
    expect(noticeFrom({})).toBeNull();
    expect(noticeFrom({ message: '  ' })).toBeNull();
    expect(noticeFrom({ message: 'clear_notification', data: { tag: 'x' } })).toBeNull();
    expect(noticeFrom({ message: 'request_location_update' })).toBeNull();
    expect(noticeFrom({ message: '🧺' })).toBeNull();
  });
});

describe('alarm notices', () => {
  it('matches the configured words in the title or message, in any case', () => {
    expect(noticeFrom({ title: 'Shoe Rack', message: 'A shoe rack door was opened.' }, ['shoe rack'])?.tone).toBe('alarm');
    expect(noticeFrom({ message: 'SHOE RACK opened' }, ['Shoe rack'])?.tone).toBe('alarm');
    expect(noticeFrom({ message: 'Laundry is done! 🧺' }, ['shoe rack'])?.tone).toBe('ok');
    expect(noticeFrom({ message: 'Laundry is done!' }, ['', '  '])?.tone).toBe('ok');
  });

  it('follows the companion app alarm flags', () => {
    expect(noticeFrom({ message: 'Water leak!', data: { channel: 'alarm_stream' } })?.tone).toBe('alarm');
    expect(noticeFrom({ message: 'Smoke', data: { push: { 'interruption-level': 'critical' } } })?.tone).toBe('alarm');
    expect(noticeFrom({ message: 'Smoke', data: { push: { sound: { name: 'default', critical: 1, volume: 1 } } } })?.tone).toBe('alarm');
    expect(noticeFrom({ message: 'Hi', data: { channel: 'General', priority: 'high' } })?.tone).toBe('ok');
  });
});

describe('tone asked for by the automation', () => {
  it('wins over the alarm words and the wording', () => {
    expect(noticeFrom({ message: 'Vacuum finished cleaning', data: { dashboard: 'warn' } })?.tone).toBe('warn');
    expect(noticeFrom({ message: 'Main door opened', data: { dashboard: 'alarm' } })?.tone).toBe('alarm');
    expect(noticeFrom({ message: 'Shoe rack opened (test)', data: { dashboard: 'ok' } }, ['shoe rack'])?.tone).toBe('ok');
    expect(noticeFrom({ message: 'Car unlocked', data: { dashboard: 'ok' } })?.tone).toBe('ok');
  });

  it('ignores unknown values', () => {
    expect(noticeFrom({ message: 'Hello', data: { dashboard: 'loud' } })?.tone).toBe('ok');
    expect(noticeFrom({ message: 'Door left open', data: { dashboard: 1 } })?.tone).toBe('warn');
  });
});

describe('dismiss when resolved', () => {
  it('reads data.dashboard_dismiss as a string or a list', () => {
    expect(noticeFrom({ message: 'Door open', data: { dashboard_dismiss: { entity_id: 'binary_sensor.door', state: 'off' } } })?.dismissWhen).toEqual({
      entities: ['binary_sensor.door'],
      states: ['off'],
    });
    expect(noticeFrom({ message: 'Laundry', data: { dashboard_dismiss: { entity_id: ['binary_sensor.a', 'binary_sensor.b'], state: ['on'] } } })?.dismissWhen).toEqual({
      entities: ['binary_sensor.a', 'binary_sensor.b'],
      states: ['on'],
    });
  });

  it('ignores an incomplete one', () => {
    expect(noticeFrom({ message: 'Door open', data: { dashboard_dismiss: { entity_id: 'binary_sensor.door' } } })?.dismissWhen).toBeUndefined();
    expect(noticeFrom({ message: 'Door open', data: { dashboard_dismiss: 'binary_sensor.door' } })?.dismissWhen).toBeUndefined();
    expect(noticeFrom({ message: 'Door open' })).not.toHaveProperty('dismissWhen');
  });

  const since = Date.parse('2026-10-23T10:00:00Z');
  const at = (ms: number) => new Date(since + ms).toISOString();
  const dw = { entities: ['binary_sensor.door', 'binary_sensor.other'], states: ['off'] };

  it('counts a change to a resolving state after the alert came in', () => {
    expect(isResolved(dw, { 'binary_sensor.door': { state: 'off', last_changed: at(3_000) } }, since)).toBe(true);
    expect(isResolved(dw, { 'binary_sensor.other': { state: 'off', last_changed: at(60_000) } }, since)).toBe(true);
    expect(isResolved(dw, { 'binary_sensor.door': { state: 'on', last_changed: at(3_000) } }, since)).toBe(false);
    expect(isResolved(dw, {}, since)).toBe(false);
  });

  it('allows a few seconds of race but not an old state', () => {
    expect(isResolved(dw, { 'binary_sensor.door': { state: 'off', last_changed: at(-4_000) } }, since)).toBe(true);
    // Closed two minutes before a late alert (e.g. after an arrival check): keep showing it.
    expect(isResolved(dw, { 'binary_sensor.door': { state: 'off', last_changed: at(-120_000) } }, since)).toBe(false);
  });
});
