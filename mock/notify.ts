// HA's call_service events for notify.* (see subscribeNotifyCalls). A notify
// service call, the alerts test panel and window.__mockNotify('notify', { message }) fire them.
type Listener = (service: string, data: Record<string, unknown>) => void;
export const notifyListeners = new Set<Listener>();

export function mockNotify(service: string, data: Record<string, unknown>) {
  notifyListeners.forEach((l) => l(service, data));
}
