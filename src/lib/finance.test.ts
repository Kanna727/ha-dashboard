import { describe, expect, it } from 'vitest';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { bankColor, daysUntil, fmtAgo, fmtWhen, rowColors, dueLabel, findFinance, fmtInr, fmtShort, isBillCard, monthSpend, netWorthRange, parseAmount, parseBill, parseMoneyHistory, parseTransaction, parseWhen, scoreBand } from './finance';

const e = (entity_id: string, state: string, friendly_name?: string, last_changed = ''): HassEntity => ({
  entity_id,
  state,
  attributes: friendly_name ? { friendly_name } : {},
  last_changed,
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});
const states = (...list: HassEntity[]): HassEntities => Object.fromEntries(list.map((x) => [x.entity_id, x]));

describe('parseAmount', () => {
  it('reads rupee amounts with Indian grouping and either minus sign', () => {
    expect(parseAmount('₹1,250.40')).toBe(1250.4);
    expect(parseAmount('−₹80.50')).toBe(-80.5);
    expect(parseAmount('-₹1,23,456')).toBe(-123456);
    expect(parseAmount('no money')).toBeUndefined();
  });
});

describe('parseBill / parseTransaction / parseWhen', () => {
  it('splits the next bill into card, last digits and amount', () => {
    expect(parseBill('Kotak ••4410 · ₹1,250.00 due 05 Nov')).toEqual({ card: 'Kotak ••4410', last4: '4410', amount: 1250 });
    expect(parseBill('unknown')).toBeUndefined();
    expect(parseBill('No unpaid bills')).toBeUndefined();
  });
  it('splits the last transaction', () => {
    expect(parseTransaction('−₹80.00 · Corner Cafe · Food & Drinks · Kotak ••4410')).toEqual({
      amount: -80,
      merchant: 'Corner Cafe',
      category: 'Food & Drinks',
      account: 'Kotak ••4410',
    });
    expect(parseTransaction('')).toBeUndefined();
  });
  it('reads input_datetime states as local time', () => {
    expect(parseWhen('2026-11-02 15:18:12')).toBe(new Date(2026, 10, 2, 15, 18, 12).getTime());
    expect(parseWhen('unknown')).toBeUndefined();
  });
});

describe('findFinance', () => {
  const s = states(
    e('input_number.fold_net_worth', '1500.5'),
    e('input_number.fold_debt', '200'),
    e('sensor.fold_debt', '999'),
    e('input_number.fold_bank_total', '1300'),
    e('input_number.fold_bank_kotak_1111', '1500', 'Fold Bank Kotak 1111'),
    e('input_number.fold_bank_canara_2222', '-200', 'Fold Bank Canara 2222'),
    e('input_number.fold_cc_kotak_league_4410', '150', 'Fold CC Kotak League 4410'),
    e('input_number.fold_cc_amex_gold_9001', '0', 'Fold CC Amex Gold 9001'),
    e('input_number.fold_cc_au_lit_3003', 'unavailable', 'Fold CC AU LIT 3003'),
    e('input_number.fold_credit_score_cibil', '781', 'Fold Credit Score CIBIL'),
    e('input_text.fold_next_cc_bill', 'Kotak ••4410 · ₹150.00 due 05 Nov'),
    e('input_datetime.fold_next_cc_due_date', '2026-11-05'),
    e('input_text.fold_last_transaction', '−₹80.00 · Corner Cafe · Food & Drinks · Kotak ••4410'),
    e('input_text.fold_sync_cursor', 'abc'),
    e('input_datetime.fold_data_as_of', '2026-11-02 15:18:12'),
    e('input_number.other_thing', '5'),
  );
  const f = findFinance(s)!;

  it('reads the totals, a helper winning over a sensor of the same name', () => {
    expect(f.netWorth).toBe(1500.5);
    expect(f.debt).toBe(200);
    expect(f.bankTotal).toBe(1300);
    expect(f.loans).toBeUndefined();
  });
  it('finds accounts, highest first, with names from their friendly names', () => {
    expect(f.banks.map((b) => [b.name, b.last4, b.balance])).toEqual([
      ['Kotak', '1111', 1500],
      ['Canara', '2222', -200],
    ]);
  });
  it('finds cards, most owed first, skipping ones without a number', () => {
    expect(f.cards.map((c) => [c.bank, c.product, c.last4, c.balance])).toEqual([
      ['Kotak', 'League', '4410', 150],
      ['Amex', 'Gold', '9001', 0],
    ]);
  });
  it('finds scores, the bill, the last transaction and the time', () => {
    expect(f.scores).toEqual([{ id: 'input_number.fold_credit_score_cibil', bureau: 'CIBIL', score: 781 }]);
    expect(f.bill).toEqual({ card: 'Kotak ••4410', last4: '4410', amount: 150, due: '2026-11-05' });
    expect(f.lastTransaction?.merchant).toBe('Corner Cafe');
    expect(f.asOf).toBe(new Date(2026, 10, 2, 15, 18, 12).getTime());
  });
  it('marks the card whose bill is next', () => {
    expect(isBillCard(f.cards[0], f.bill)).toBe(true);
    expect(isBillCard(f.cards[1], f.bill)).toBe(false);
  });
  it('has no bill once the bills are paid, whatever the old due date says', () => {
    const paid = (text: string, unpaid: string) =>
      findFinance(
        states(
          e('input_text.fold_next_cc_bill', text),
          e('input_datetime.fold_next_cc_due_date', '2026-11-05'),
          e('input_number.fold_cc_bills_unpaid', unpaid),
        ),
      )!.bill;
    expect(paid('No unpaid bills', '0')).toBeUndefined();
    expect(paid('Kotak ••4410 · ₹150.00 due 05 Nov', '0')).toBeUndefined();
    expect(paid('Kotak ••4410 · ₹150.00 due 05 Nov', '150')?.due).toBe('2026-11-05');
  });
  it('knows when any number last changed, apart from when the banks were fetched', () => {
    const g = findFinance(
      states(
        e('input_number.fold_net_worth', '1', undefined, '2026-11-03T10:00:00Z'),
        e('input_text.fold_last_transaction', '−₹1.00 · A · B · C', undefined, '2026-11-03T15:30:00Z'),
        e('input_text.fold_sync_cursor', 'x', undefined, '2026-11-03T16:00:00Z'),
        e('input_datetime.fold_data_as_of', '2026-11-03 10:26:16', undefined, '2026-11-03T05:00:00Z'),
      ),
    )!;
    expect(g.changedAt).toBe(Date.parse('2026-11-03T15:30:00Z'));
    expect(g.asOf).toBe(new Date(2026, 10, 3, 10, 26, 16).getTime());
  });
  it('falls back to the object id without a friendly name', () => {
    const g = findFinance(states(e('sensor.money_bank_hdfc_1234', '10')), 'money')!;
    expect(g.banks[0]).toMatchObject({ bank: 'hdfc', last4: '1234' });
  });
  it('is undefined with no helpers', () => {
    expect(findFinance(states(e('input_number.other_thing', '5')))).toBeUndefined();
  });
});

describe('dates and formatting', () => {
  it('counts days to a due date', () => {
    const now = new Date(2026, 10, 3, 23, 30);
    expect(daysUntil('2026-11-05', now)).toBe(2);
    expect(daysUntil('2026-11-03', now)).toBe(0);
    expect(daysUntil('2026-11-01', now)).toBe(-2);
    expect([dueLabel(2), dueLabel(1), dueLabel(0), dueLabel(-1)]).toEqual(['Due in 2 days', 'Due tomorrow', 'Due today', '1 day overdue']);
  });
  it('says how long ago and when', () => {
    const now = new Date(2026, 10, 3, 21, 0);
    const at = (h: number, m = 0, d = 3) => new Date(2026, 10, d, h, m).getTime();
    expect([fmtAgo(at(21), now.getTime()), fmtAgo(at(20, 48), now.getTime()), fmtAgo(at(10, 26), now.getTime()), fmtAgo(at(9, 0, 1), now.getTime())]).toEqual(['just now', '12 min ago', '11h ago', '3d ago']);
    expect(fmtWhen(at(10, 26), now)).toMatch(/^10:26\s?am$/);
    expect(fmtWhen(at(10, 17, 2), now)).toMatch(/^yesterday 10:17\s?am$/);
    expect(fmtWhen(at(10, 0, 1), now)).toBe('1 Nov');
  });
  it('formats rupees', () => {
    expect(fmtInr(412500.6)).toBe('₹4,12,501');
    expect(fmtInr(-80.5, 2)).toBe('−₹80.50');
    expect([fmtShort(12345678), fmtShort(412500), fmtShort(-22220), fmtShort(640)]).toEqual(['₹1.23 Cr', '₹4.13 L', '−₹22.2K', '₹640']);
  });
  it('bands scores and colours banks', () => {
    expect([scoreBand(804).label, scoreBand(782).label, scoreBand(720).tone, scoreBand(600).tone]).toEqual(['Excellent', 'Very good', 'fair', 'bad']);
    expect(bankColor('HDFC')).toBe('#3b82f6');
    expect(bankColor('Some New Bank')).toBe(bankColor('Some New Bank'));
  });
});

describe('chart data', () => {
  const h = parseMoneyHistory({
    version: 1,
    updated: '2026-11-03T07:28:00+05:30',
    net_worth: [['2026-11-02', 120], ['2026-11-01', '100'], ['bad', 5], ['2026-10-01', 90]],
    spending: [
      { month: '2026-11', total: 500, categories: { 'Credit Bill': 300, Food: 150, Fuel: 50, Zero: 0 } },
      { month: '2026-10', categories: { Food: 80, Rent: 120 } },
      { month: 'oops', total: 1 },
    ],
    upcoming: [{ date: '2026-12-01', name: 'Rent', amount: 400 }, { date: '2026-11-20', name: 'Gym', amount: '30', category: 'Fitness' }, { name: 'x' }],
  });
  it('parses series, sorted, dropping what is malformed', () => {
    expect(h.netWorth.map((p) => p.v)).toEqual([90, 100, 120]);
    expect(h.months.map((m) => [m.month, m.total])).toEqual([['2026-10', 200], ['2026-11', 500]]);
    expect(h.months[1].categories[0]).toEqual(['Credit Bill', 300]);
    expect(h.upcoming.map((u) => u.name)).toEqual(['Gym', 'Rent']);
    expect(h.updated).toBe(Date.parse('2026-11-03T07:28:00+05:30'));
    expect(parseMoneyHistory(null)).toEqual({ updated: undefined, netWorth: [], months: [], upcoming: [] });
  });
  it('leaves card bill payments out of a month', () => {
    expect(monthSpend(h.months[1], ['credit bill'])).toEqual({ total: 200, categories: [['Food', 150], ['Fuel', 50]] });
  });
  it('gives the change, low and high over a range', () => {
    const r = netWorthRange(h.netWorth, 7, new Date(2026, 10, 3).getTime());
    expect(r.points.length).toBe(2);
    expect([r.change, r.low?.v, r.high?.v]).toEqual([20, 100, 120]);
  });
  it('gives each category row its own colour, Untagged and Other grey', () => {
    const c = rowColors(['Untagged', 'Food', 'Fuel', 'Bill', 'Other']);
    expect(new Set(c.slice(1, 4)).size).toBe(3);
    expect([c[0], c[4]]).toEqual(['#64748b', '#64748b']);
  });
});

describe('findFinance: totals named like cards', () => {
  it('reads the card limit, available credit and utilisation as totals, not cards', () => {
    const f = findFinance(
      states(
        e('input_number.fold_cc_credit_limit', '500000', 'Fold CC Credit Limit'),
        e('input_number.fold_cc_available_credit', '450000', 'Fold CC Available Credit'),
        e('input_number.fold_cc_utilization', '10', 'Fold CC Utilization'),
        e('input_number.fold_cc_some_new_total', '1', 'Fold CC Some New Total'),
        e('input_number.fold_bank_something', '1'),
        e('input_number.fold_cc_kotak_league_4410', '150', 'Fold CC Kotak League 4410'),
        e('input_number.fold_mutual_funds_gain_percent', '2.4'),
        e('input_number.fold_health_cover', '5000000'),
        e('input_datetime.fold_next_premium_date', '2029-04-28'),
        e('input_datetime.fold_snapshot_updated', '2026-11-07 07:49:19'),
      ),
    )!;
    expect(f.cards.map((c) => c.name)).toEqual(['Kotak League']);
    expect(f.banks).toEqual([]);
    expect(f).toMatchObject({ cardsLimit: 500000, cardsAvailable: 450000, cardsUtilization: 10, fundsGainPct: 2.4, healthCover: 5000000, premiumDue: '2029-04-28' });
    expect(f.snapshotAt).toBe(new Date(2026, 10, 7, 7, 49, 19).getTime());
  });
});
