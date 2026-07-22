import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatCaliberLabel } from '../pages/homeWeaponFilters.js';
import { useI18n } from '../i18n/useI18n.js';

const FOCUSABLE_SELECTOR = 'button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

function HomeFilterModal({ calibers, onApply, onClose, selectedCaliber, selectedType, types }) {
  const { t } = useI18n();
  const [draftType, setDraftType] = useState(selectedType);
  const [draftCaliber, setDraftCaliber] = useState(selectedCaliber);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('select')?.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = [...(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])];
      if (focusableElements.length === 0) return;
      const first = focusableElements[0];
      const last = focusableElements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="home-filter-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section id="homeFilterModal" className="home-filter-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="homeFilterModalTitle" aria-describedby="homeFilterModalDescription" ref={dialogRef}>
        <header className="home-filter-modal__header">
          <div>
            <h2 id="homeFilterModalTitle">{t('filter.title')}</h2>
            <p id="homeFilterModalDescription">{t('filter.description')}</p>
          </div>
          <button className="btn btn--ghost" type="button" onClick={onClose}>{t('common.close')}</button>
        </header>
        <div className="home-filter-modal__body">
          <label className="home-filter-modal__field">
            <span>{t('filter.weaponType')}</span>
            <select value={draftType} onChange={event => setDraftType(event.target.value)}>
              <option value="All">{t('filter.allTypes')}</option>
              {types.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="home-filter-modal__field">
            <span>{t('filter.caliber')}</span>
            <select value={draftCaliber} onChange={event => setDraftCaliber(event.target.value)}>
              <option value="All">{t('filter.allCalibers')}</option>
              {calibers.map(caliber => <option key={caliber} value={caliber}>{formatCaliberLabel(caliber)}</option>)}
            </select>
          </label>
        </div>
        <footer className="home-filter-modal__actions">
          <button className="btn btn--ghost" type="button" onClick={() => { setDraftType('All'); setDraftCaliber('All'); }}>{t('common.reset')}</button>
          <div>
            <button className="btn btn--ghost" type="button" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn--primary" type="button" onClick={() => onApply({ type: draftType, caliber: draftCaliber })}>{t('common.apply')}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default HomeFilterModal;
