// How the editor is reached: the cog in the top bar (admin logins only: saving the
// config needs one) and a ?setup link. Mounted once by App.
import { useEffect } from 'react';
import { Icon } from '../components/Icon';
import { useHassStatus } from '../ha/api';
import { SetupEditor } from './SetupEditor';
import { closeSetup, openSetup, useSetupOpen } from './setupStore';

export function SetupButton() {
  const { isAdmin } = useHassStatus();
  if (isAdmin === false) return null;
  return (
    <button className="pill icon-pill" onClick={openSetup} aria-label="Dashboard setup" title="Dashboard setup">
      <Icon name="cog" size={22} />
    </button>
  );
}

export function SetupHost() {
  const open = useSetupOpen();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('setup')) openSetup();
  }, []);
  return open ? <SetupEditor onClose={closeSetup} /> : null;
}
