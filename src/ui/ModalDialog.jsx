import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isFocusable(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getFocusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isFocusable);
}

function ModalDialog({
  backdropClassName,
  children,
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocus,
  onClose,
  returnFocusRef,
  role = 'dialog',
  style,
  ...dialogProps
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeOnBackdropRef = useRef(closeOnBackdrop);
  const closeOnEscapeRef = useRef(closeOnEscape);
  const returnFocusTargetRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnBackdropRef.current = closeOnBackdrop;
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnBackdrop, closeOnEscape, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    if (!returnFocusTargetRef.current) {
      returnFocusTargetRef.current = returnFocusRef?.current || document.activeElement;
    }

    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.inert === true;
    const rootHadInertAttribute = appRoot?.hasAttribute('inert') === true;
    const previousOverflow = document.body.style.overflow;

    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute('inert', '');
    }
    document.body.style.overflow = 'hidden';

    const initialTarget = initialFocus === 'dialog'
      ? dialog
      : typeof initialFocus === 'string'
        ? dialog.querySelector(initialFocus)
        : initialFocus?.current;
    const autoFocusTarget = dialog.querySelector('[autofocus]');
    const firstFocusable = getFocusableElements(dialog)[0];
    const focusTarget = (
      (initialTarget && isFocusable(initialTarget) ? initialTarget : null)
      || (autoFocusTarget && isFocusable(autoFocusTarget) ? autoFocusTarget : null)
      || firstFocusable
      || dialog
    );
    focusTarget.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements.at(-1);
      const focusIsOutside = !dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        appRoot.inert = rootWasInert;
        if (rootHadInertAttribute) appRoot.setAttribute('inert', '');
        else appRoot.removeAttribute('inert');
      }
      const returnFocusTarget = returnFocusTargetRef.current;
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
    };
  }, [initialFocus, returnFocusRef]);

  return createPortal(
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && closeOnBackdropRef.current) {
          onCloseRef.current();
        }
      }}
    >
      <section
        {...dialogProps}
        className={className}
        ref={dialogRef}
        role={role}
        aria-modal="true"
        tabIndex={-1}
        style={{ overscrollBehavior: 'contain', ...style }}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}

export default ModalDialog;
