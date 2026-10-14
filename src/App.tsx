import { useEffect, useState } from 'react';
import { ModalProvider } from './components/Modal';
import { SheetProvider } from './components/Sheet';
import { ToastProvider } from './components/Toasts';
import { Alerts } from './components/Alerts';
import { DesktopLayout, PhoneLayout, TabletLayout } from './layout/Layouts';
import { useSunTheme } from './theme/useSunTheme';
import { useSelfUpdate } from './update/useSelfUpdate';

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
  const theme = useSunTheme();
  useSelfUpdate();

  useEffect(() => {
    const onResize = () => setLayout(detectLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const props = { themeMode: theme.mode, onTheme: theme.cycle };
  return (
    <SheetProvider>
      <ModalProvider>
        <ToastProvider>
          <Alerts />
          {layout === 'phone' ? <PhoneLayout {...props} /> : layout === 'tablet' ? <TabletLayout {...props} /> : <DesktopLayout {...props} />}
        </ToastProvider>
      </ModalProvider>
    </SheetProvider>
  );
}
