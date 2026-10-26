import { useEffect, useState } from 'react';
import { Icon } from './Icon';

// Copies text to the clipboard. The async clipboard API only exists on secure
// origins (HTTPS or localhost); the dashboard is often served over plain HTTP
// on the LAN, so fall back to a hidden textarea and execCommand('copy').
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', userSelect: 'text', webkitUserSelect: 'text' });
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS ignores select() alone
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// A small icon button that copies `text` and shows a tick (or a cross) for a moment.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(null), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      className={`copy-btn ${done ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((ok) => setDone(ok ? 'ok' : 'fail'));
      }}
      aria-label={done === 'ok' ? `${label} copied` : `Copy ${label}`}
      title={done === 'ok' ? 'Copied' : done === 'fail' ? 'Couldn’t copy' : `Copy ${label}`}
    >
      <Icon name={done === 'ok' ? 'check' : done === 'fail' ? 'close' : 'copy'} size={15} />
      {done === 'ok' && <span>Copied</span>}
    </button>
  );
}
