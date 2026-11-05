import { describe, expect, it } from 'vitest';
import { LIVE_MAX_MS, appLook, appName, freshUpdates, posted, readNotification, removed, type NotificationState } from './liveUpdates';

const PHONE = 'sensor.phone_last_notification';
const REMOVED = 'sensor.phone_last_removed_notification';

// The attributes as the companion app sends them, unset fields as the text "null".
const tracking = (over: Record<string, unknown> = {}): NotificationState => ({
  entity_id: PHONE,
  state: 'Coming to your doorstep',
  attributes: {
    package: 'com.application.quickbite',
    post_time: 1000,
    is_ongoing: true,
    'android.requestPromotedOngoing': true,
    'android.title': 'Arriving now',
    'android.text': 'Coming to your doorstep',
    'android.subText': 'Green Park',
    'android.progress': 95,
    'android.progressMax': 100,
    'android.progressIndeterminate': false,
    ...over,
  },
});
const ordinary = (post_time = 2000): NotificationState => ({
  entity_id: PHONE,
  state: 'Order delivered',
  attributes: {
    package: 'com.application.quickbite',
    post_time,
    is_ongoing: false,
    'android.requestPromotedOngoing': false,
    'android.title': 'Tip your delivery partner',
    'android.bigText': 'Order delivered',
    'android.subText': 'Green Park',
    'android.progress': 0,
    'android.progressMax': 0,
  },
});

describe('appName', () => {
  it('skips the boilerplate parts of a package', () => {
    expect(appName('com.application.quickbite')).toBe('Quickbite');
    expect(appName('in.foodgo.android')).toBe('Foodgo');
    expect(appName('com.google.android.apps.maps')).toBe('Maps');
  });

  it('falls back to the package', () => {
    expect(appName('com.android')).toBe('Com.android');
  });
});

describe('appLook', () => {
  it('gives a known app its logo and a rider', () => {
    expect(appName('com.application.zomato')).toBe('Zomato');
    expect(appLook('com.application.zomato')).toMatchObject({ logo: expect.stringContaining('zomato.com'), delivery: true });
  });

  it('gives any other app a steady colour and no logo', () => {
    const look = appLook('com.application.quickbite');
    expect(look.logo).toBeUndefined();
    expect(look.delivery).toBe(false);
    expect(look.color).toBe(appLook('com.application.quickbite').color);
  });
});

describe('readNotification', () => {
  it('reads a Live Update', () => {
    expect(readNotification(tracking())?.live).toEqual({
      key: 'sensor.phone|com.application.quickbite',
      app: 'Quickbite',
      title: 'Arriving now',
      text: 'Coming to your doorstep',
      percent: 95,
      at: 1000,
      ...appLook('com.application.quickbite'),
    });
  });

  it('accepts the flags as text', () => {
    expect(readNotification(tracking({ is_ongoing: 'true', 'android.requestPromotedOngoing': 'True' }))?.live).toBeDefined();
  });

  it('leaves out what the app left unset', () => {
    expect(readNotification(tracking({ 'android.progressIndeterminate': true }))?.live?.percent).toBeUndefined();
    expect(readNotification(tracking({ 'android.progressMax': 0 }))?.live?.percent).toBeUndefined();
  });

  it('uses the text as the title when there is no title', () => {
    expect(readNotification(tracking({ 'android.title': 'null' }))?.live).toMatchObject({ title: 'Coming to your doorstep', text: undefined });
  });

  it('is not live without both flags', () => {
    expect(readNotification(ordinary())).toEqual({ key: 'sensor.phone|com.application.quickbite', at: 2000 });
    expect(readNotification(tracking({ is_ongoing: false }))?.live).toBeUndefined();
    expect(readNotification(tracking({ 'android.requestPromotedOngoing': false }))?.live).toBeUndefined();
  });

  it('ignores a reading with no words or no app', () => {
    expect(readNotification(tracking({ 'android.title': 'null', 'android.text': 'null' }))).toBeNull();
    expect(readNotification({ entity_id: PHONE, state: 'unknown', attributes: {} })).toBeNull();
  });

  it('gives the removed sensor the same card', () => {
    expect(readNotification({ ...tracking(), entity_id: REMOVED })?.key).toBe(readNotification(tracking())?.key);
  });
});

describe('posted', () => {
  const first = posted([], readNotification(tracking()));

  it('adds a card, and updates it in place', () => {
    expect(first).toHaveLength(1);
    const next = posted(first, readNotification(tracking({ post_time: 1500, 'android.title': 'On the way' })));
    expect(next).toHaveLength(1);
    expect(next[0].title).toBe('On the way');
  });

  it('keeps one card per app', () => {
    const other = readNotification(tracking({ package: 'in.foodgo.android' }));
    expect(posted(first, other).map((u) => u.app)).toEqual(['Quickbite', 'Foodgo']);
  });

  it('drops the card when the app posts an ordinary notification', () => {
    expect(posted(first, readNotification(ordinary()))).toEqual([]);
  });

  it('ignores news older than the card', () => {
    expect(posted(first, readNotification(ordinary(500)))).toBe(first);
    expect(posted(first, readNotification(tracking({ post_time: 500, 'android.title': 'Old' })))).toBe(first);
  });

  it('keeps the card through a group summary', () => {
    const summary = { entity_id: PHONE, state: 'com.application.quickbite', attributes: { package: 'com.application.quickbite', post_time: 2000 } };
    expect(posted(first, readNotification(summary))).toBe(first);
  });

  it("changes nothing for another app's ordinary notification", () => {
    const other = ordinary();
    expect(posted(first, readNotification({ ...other, attributes: { ...other.attributes, package: 'in.foodgo.android' } }))).toBe(first);
  });
});

describe('removed', () => {
  const first = posted([], readNotification(tracking()));

  it('drops the card when its Live Update is removed', () => {
    expect(removed(first, readNotification({ ...tracking(), entity_id: REMOVED }))).toEqual([]);
  });

  it('keeps the card when something else was removed', () => {
    expect(removed(first, readNotification({ ...ordinary(), entity_id: REMOVED }))).toBe(first);
    expect(removed(first, null)).toBe(first);
  });

  it('keeps a card that is newer than the removal', () => {
    const newer = posted(first, readNotification(tracking({ post_time: 1500 })));
    expect(removed(newer, readNotification({ ...tracking(), entity_id: REMOVED }))).toBe(newer);
  });
});

describe('freshUpdates', () => {
  it('drops a card that has gone quiet', () => {
    const list = posted([], readNotification(tracking()));
    expect(freshUpdates(list, 1000 + LIVE_MAX_MS - 1)).toHaveLength(1);
    expect(freshUpdates(list, 1000 + LIVE_MAX_MS)).toHaveLength(0);
  });
});
