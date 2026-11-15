import { useEffect, useLayoutEffect, useState } from 'react';
import { ModalProvider } from './components/Modal';
import { SheetProvider } from './components/Sheet';
import { ToastProvider } from './components/Toasts';
import { Alerts } from './components/Alerts';
import { Doorbell } from './components/Doorbell';
import { NightMode } from './components/NightMode';
import { ScreenPower } from './components/ScreenPower';
import { MedicinesToHa } from './medicines/MedicinesToHa';
import { IdleHome } from './layout/IdleHome';
import { SkyBackdrop } from './components/SkyBackdrop';
import { DesktopLayout, PhoneLayout, TabletLayout } from './layout/Layouts';
import { useSelfUpdate } from './update/useSelfUpdate';
import { useVacuumAutoOpen } from './vacuum/useAutoOpen';
import { setMoneyLayout } from './money/privacy';
import { isDraftPreview } from './config/load';
import { SetupHost } from './setup/SetupHost';

type LayoutName = 'tablet' | 'phone' | 'desktop';

// Kiosk URLs pin the layout with ?layout=; otherwise pick by viewport.
function detectLayout(): LayoutName {
  const forced = new URLSearchParams(window.location.search).get('layout');
  if (forced === 'tablet' || forced === 'phone' || forced === 'desktop') return forced;
  const w = window.innerWidth;
  if (w < 700) return 'phone';
  const touch = window.matchMedia('(pointer: coarse)').matches;
  return touch && w <= 1400 ? 'tablet' : 'desktop';
}

export function App() {
  const [layout, setLayout] = useState<LayoutName>(detectLayout);
  const preview = isDraftPreview();
  useSelfUpdate();
  useVacuumAutoOpen();
  // Before paint, so amounts on the Money page start blurred or not without a flash.
  useLayoutEffect(() => setMoneyLayout(layout), [layout]);

  useEffect(() => {
    const onResize = () => setLayout(detectLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <SheetProvider>
      <ModalProvider>
        <ToastProvider>
          <SkyBackdrop />
          {/* The setup editor's preview shows the layout only: no alerts, camera, night screen or HA writes. */}
          {!preview && (
            <>
              <Alerts />
              <Doorbell />
              <NightMode layout={layout} />
              <IdleHome layout={layout} />
              <ScreenPower />
              <MedicinesToHa />
              <SetupHost />
            </>
          )}
          {layout === 'phone' ? <PhoneLayout /> : layout === 'tablet' ? <TabletLayout /> : <DesktopLayout />}
        </ToastProvider>
      </ModalProvider>
    </SheetProvider>
  );
}
