import { useEffect, useRef } from 'react';

const dialogStack: HTMLElement[] = [];
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keeps keyboard navigation in the top dialog and returns focus to its opener. */
export function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogStack.push(dialog);
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
    const focusFirst = () => (controls()[0] || dialog).focus({ preventScroll: true });
    focusFirst();
    const isTop = () => dialogStack.at(-1) === dialog;
    const keydown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      const wasTop = isTop();
      const index = dialogStack.indexOf(dialog);
      if (index >= 0) dialogStack.splice(index, 1);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
