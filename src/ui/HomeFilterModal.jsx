import { useState } from 'react';

import { formatCaliberLabel } from '../pages/homeWeaponFilters.js';
import { useI18n } from '../i18n/useI18n.js';
import ModalDialog from './ModalDialog.jsx';

function HomeFilterModal({ calibers, onApply, onClose, selectedCaliber, selectedTrader, traders }) {
  const { t } = useI18n();
  const [draftCaliber, setDraftCaliber] = useState(selectedCaliber);
  const [draftTrader, setDraftTrader] = useState(selectedTrader);

  return (
    <ModalDialog
      id="homeFilterModal"
      backdropClassName="home-filter-modal"
      className="home-filter-modal__dialog"
      aria-labelledby="homeFilterModalTitle"
      aria-describedby="homeFilterModalDescription"
      initialFocus="select"
      onClose={onClose}
    >
        <header className="home-filter-modal__header">
          <div>
            <h2 id="homeFilterModalTitle">{t('filter.title')}</h2>
            <p id="homeFilterModalDescription">{t('filter.description')}</p>
          </div>
        </header>
        <div className="home-filter-modal__body">
          <label className="home-filter-modal__field">
            <span>{t('filter.caliber')}</span>
            <select value={draftCaliber} onChange={event => setDraftCaliber(event.target.value)}>
              <option value="All">{t('filter.allCalibers')}</option>
              {calibers.map(caliber => <option key={caliber} value={caliber}>{formatCaliberLabel(caliber)}</option>)}
            </select>
          </label>
          <label className="home-filter-modal__field">
            <span>{t('filter.trader')}</span>
            <select value={draftTrader} onChange={event => setDraftTrader(event.target.value)}>
              <option value="All">{t('filter.allTraders')}</option>
              {traders.map(trader => <option key={trader.id} value={trader.id}>{trader.name}</option>)}
            </select>
          </label>
        </div>
        <footer className="home-filter-modal__actions">
          <button className="btn btn--ghost" type="button" onClick={() => { setDraftCaliber('All'); setDraftTrader('All'); }}>{t('common.reset')}</button>
          <div>
            <button className="btn btn--ghost" type="button" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn--primary" type="button" onClick={() => onApply({ caliber: draftCaliber, trader: draftTrader })}>{t('common.apply')}</button>
          </div>
        </footer>
    </ModalDialog>
  );
}

export default HomeFilterModal;
