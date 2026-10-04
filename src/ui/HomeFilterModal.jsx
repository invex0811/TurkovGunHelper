import { useState } from 'react';

import { formatCaliberLabel } from '../pages/homeWeaponFilters.js';
import { useI18n } from '../i18n/useI18n.js';
import ModalDialog from './ModalDialog.jsx';
import SelectButton from './SelectButton.jsx';

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
      initialFocus=".select-button__trigger"
      onClose={onClose}
    >
        <header className="home-filter-modal__header">
          <div>
            <h2 id="homeFilterModalTitle">{t('filter.title')}</h2>
            <p id="homeFilterModalDescription">{t('filter.description')}</p>
          </div>
        </header>
        <div className="home-filter-modal__body">
          <div className="home-filter-modal__field">
            <label id="homeFilterCaliberLabel" htmlFor="homeFilterCaliber">{t('filter.caliber')}</label>
            <SelectButton
              id="homeFilterCaliber"
              labelId="homeFilterCaliberLabel"
              options={[
                { value: 'All', label: t('filter.allCalibers') },
                ...calibers.map(caliber => ({ value: caliber, label: formatCaliberLabel(caliber) })),
              ]}
              value={draftCaliber}
              onChange={setDraftCaliber}
            />
          </div>
          <div className="home-filter-modal__field">
            <label id="homeFilterTraderLabel" htmlFor="homeFilterTrader">{t('filter.trader')}</label>
            <SelectButton
              id="homeFilterTrader"
              labelId="homeFilterTraderLabel"
              options={[
                { value: 'All', label: t('filter.allTraders') },
                ...traders.map(trader => ({ value: trader.id, label: trader.name })),
              ]}
              value={draftTrader}
              onChange={setDraftTrader}
            />
          </div>
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
