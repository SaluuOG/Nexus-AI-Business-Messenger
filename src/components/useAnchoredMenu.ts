import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export function useAnchoredMenu() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const [open, setOpen] = useState(false);

  const closeMenu = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const popup = menu.current;
    const anchor = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right = left + (viewport?.width ?? window.innerWidth) - 16;
    const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
    popup.style.maxWidth = `${right - left}px`;
    popup.style.maxHeight = `${bottom - top}px`;
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(left, Math.min(anchor.right - bounds.width, right - bounds.width))}px`;
    popup.style.top = `${Math.max(top, Math.min(anchor.bottom + 4 + bounds.height <= bottom ? anchor.bottom + 4 : anchor.top - bounds.height - 4, bottom - bounds.height))}px`;
    const items = popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    (initialFocus.current === 'last' ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });

    const outside = (event: Event) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const dismiss = () => {
      if (popup.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
      setOpen(false);
    };
    const scrolled = (event: Event) => {
      if (!(event.target instanceof Node) || !popup.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', dismiss);
    viewport?.addEventListener('resize', dismiss);
    viewport?.addEventListener('scroll', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', dismiss);
      viewport?.removeEventListener('resize', dismiss);
      viewport?.removeEventListener('scroll', dismiss);
    };
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      closeMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  return { id, trigger, menu, initialFocus, open, setOpen, closeMenu, onMenuKeyDown };
}
