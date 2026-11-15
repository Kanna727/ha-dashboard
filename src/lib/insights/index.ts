// The house insights engine: from the last days of Home Assistant's history, what
// is unusual right now and what is a habit worth automating. Pure; the hook that
// fetches the history is panels/useInsights.ts. No cloud model: medians,
// spreads and clustering. See AGENTS.md "House insights".
import { doorInsights } from './doors';
import { energyInsights } from './energy';
import { habitInsights } from './habits';
import { leftOn } from './runs';
import type { Insight, InsightsInput, Severity } from './types';

export * from './types';
export { describe, automationId } from './suggest';

const RANK: Record<Severity, number> = { alert: 0, notice: 1, info: 2 };

export function buildInsights(i: InsightsInput): Insight[] {
  const out: Insight[] = [];
  for (const d of i.devices) {
    const rows = i.history[d.entity];
    if (!rows?.length) continue;
    const left = leftOn(d, rows, i.now, i.automations);
    if (left) out.push(left);
    out.push(...habitInsights(d, rows, i.now, i.automations));
  }
  for (const door of i.doors) {
    const rows = i.history[door.entity];
    if (rows?.length) out.push(...doorInsights(door, rows, i.now, i.automations));
  }
  for (const e of i.energy) out.push(...energyInsights(e, i.now));
  // Needs attention first, then the newest.
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.at - a.at || (b.score ?? 0) - (a.score ?? 0));
}
