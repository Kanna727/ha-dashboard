// The investment figures the Returns, Gains and Next-60-days cards and the net
// worth chart share: computed in lib/invest/ from the order history (the hidden
// FINANCE.ordersStore document the money sync writes), the snapshot's current
// values and the money helpers. Nothing here is advice; see lib/invest/funds.ts.
import { useMemo } from 'react';
import { FINANCE, MONEY_PEOPLE } from '../config/entities';
import { useNow } from '../hooks/useNow';
import { buildForecast, type Forecast } from '../lib/invest/forecast';
import { analyseFunds, type Report } from '../lib/invest/funds';
import { cleanSeries, type Cleaned } from '../lib/invest/netWorth';
import { parseOrders, type Order } from '../lib/invest/orders';
import { MANY_PEOPLE, picked, useMoneyPerson } from './person';
import { useFinance } from './useFinance';
import { useMoneyHistory, useSnapshot, useStoreDoc } from './useMoneyHistory';

// Each person's order document (MONEY_PEOPLE has a fixed length, so the hooks are
// always called in the same order).
function useOrderDocs(): unknown[] {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return MONEY_PEOPLE.map((p, i) => useStoreDoc(p.ordersStore, i === 0 ? 'MoneyOrders' : `MoneyOrders-${p.id}`));
}

// The chosen people's orders, oldest first. Empty until the sync writes the document.
export function useOrders(person?: string): Order[] {
  const docs = useOrderDocs();
  const current = useMoneyPerson();
  const sel = person ?? current;
  return useMemo(
    () =>
      picked(sel)
        .flatMap((i) => parseOrders(docs[i], MANY_PEOPLE ? MONEY_PEOPLE[i].id : undefined))
        .sort((a, b) => a.t - b.t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, ...docs],
  );
}

// Per-fund and overall returns, realised and unrealised gains. undefined without orders.
export function useFundReport(): Report | undefined {
  const orders = useOrders();
  const snap = useSnapshot();
  const hour = Math.floor(useNow(60_000).getTime() / 3_600_000);
  const holdings = snap.funds?.holdings;
  return useMemo(() => {
    if (!orders.length) return undefined;
    return analyseFunds(
      orders,
      (holdings ?? []).map((h) => ({ scheme: h.scheme, value: h.value, units: h.units, category: h.category, invested: h.invested, gain: h.gain, owner: h.owner })),
      hour * 3_600_000,
      { classes: FINANCE.fundClasses },
    );
  }, [orders, holdings, hour]);
}

// What is planned to go out (and come in) over the next `days` days.
export function useForecast(days = 60): Forecast | undefined {
  const orders = useOrders();
  const snap = useSnapshot();
  const history = useMoneyHistory();
  const f = useFinance();
  const day = Math.floor(useNow(60_000).getTime() / 86_400_000);
  const balance = f?.bankTotal;
  return useMemo(() => {
    if (balance === undefined) return undefined;
    return buildForecast({
      now: new Date(day * 86_400_000 + 12 * 3_600_000),
      days,
      balance,
      recurring: snap.recurring,
      upcoming: history.upcoming,
      cards: snap.cards.map((c) => ({ name: c.last4 ? `${c.name} ••${c.last4}` : c.name, outstanding: c.outstanding, cycleSpent: c.cycleSpent, statementDate: c.statementDate, lastBill: c.lastBill })),
      orders,
      income: FINANCE.expectedIncome,
    });
    // `now` is the local day, rebuilt when it changes.
  }, [balance, days, snap, history, orders, day]);
}

// The net worth line with one-day glitches smoothed away (lib/invest/netWorth.ts).
export function useCleanNetWorth(points: { t: number; v: number }[]): Cleaned {
  return useMemo(() => cleanSeries(points), [points]);
}
