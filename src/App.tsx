import { useEffect, useState } from 'react';
import { ModalProvider } from './components/Modal';
import { SheetProvider } from './components/Sheet';
import { ToastProvider } from './components/Toasts';
import { Alerts } from './components/Alerts';
import { NightMode } from './components/NightMode';
import { VacationLock } from './components/VacationMode';
import { SkyBackdrop } from './components/SkyBackdrop';
import { DesktopLayout, PhoneLayout, TabletLayout } from './layout/Layouts';
import { useSelfUpdate } from './update/useSelfUpdate';
import { useVacuumAutoOpen } from './vacuum/useAutoOpen';

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
  useSelfUpdate();
  useVacuumAutoOpen();

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
          <Alerts />
          <NightMode layout={layout} />
          <VacationLock />
          {layout === 'phone' ? <PhoneLayout /> : layout === 'tablet' ? <TabletLayout /> : <DesktopLayout />}
        </ToastProvider>
      </ModalProvider>
    </SheetProvider>
  );
}
