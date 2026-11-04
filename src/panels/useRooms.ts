import { useEffect, useMemo, useState } from 'react';
import { ROOMS, type RoomDef } from '../config/entities';
import { readCache, useRegistry, writeCache } from '../ha/useRegistry';
import { findRoomLights, withRoomLights, type RoomLights } from '../lib/roomLights';

const KEY = 'dashRoomLights';

// The configured rooms plus the bulbs discovered in their HA areas (lib/roomLights).
// Until the registry answers, the lights found last time on this device are used.
export function useRooms(): RoomDef[] {
  const registry = useRegistry();
  const [cached] = useState(() => readCache<RoomLights>(KEY, {}));
  const found = useMemo(() => (registry ? findRoomLights(ROOMS, registry) : cached), [registry, cached]);
  useEffect(() => {
    if (registry) writeCache(KEY, found);
  }, [registry, found]);
  return useMemo(() => withRoomLights(ROOMS, found), [found]);
}
