import { APPLIANCES } from '../config/entities';
import { useEntities, useEntity } from '../ha/store';
import { num } from '../ha/format';
import { purifierSummary } from '../lib/purifier';

const NO_IDS: string[] = [];

// Live purifier readings (APPLIANCES.purifier); `cfg` is undefined when the
// home has no purifier configured.
export function usePurifier() {
  const cfg = APPLIANCES.purifier;
  const tank = useEntity(cfg?.tankTds);
  const input = useEntity(cfg?.inputTds);
  const mode = useEntity(cfg?.mode);
  const faultIds = cfg?.faults?.map((f) => f.entity) ?? NO_IDS;
  const faultStates = useEntities(faultIds);
  const summary = purifierSummary({
    tankTds: num(tank),
    inputTds: num(input),
    mode: mode?.state,
    faults: (cfg?.faults ?? []).map((f, i) => ({ name: f.name, on: faultStates[i]?.state === 'on' })),
  });
  return { cfg, name: cfg?.name ?? 'Water purifier', tank, input, mode, ...summary };
}
