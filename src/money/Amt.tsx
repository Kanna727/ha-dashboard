import type { ReactNode } from 'react';
import { toggleAmounts, useAmountsHidden } from './privacy';

// An amount that blurs while amounts are hidden; a tap on a blurred one shows them.
export function Amt({ children, peek = true }: { children: ReactNode; peek?: boolean }) {
  const hidden = useAmountsHidden();
  return (
    <span
      className={`amt ${hidden ? 'hidden' : ''}`}
      onClick={
        hidden && peek
          ? (e) => {
              e.stopPropagation();
              toggleAmounts();
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}
