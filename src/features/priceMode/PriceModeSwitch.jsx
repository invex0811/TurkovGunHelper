import { PRICE_MODES } from '../../data/price/priceModes.js';
import { useI18n } from '../../i18n/useI18n.js';
import { usePriceMode } from './usePriceMode.js';
import { MaterialSymbol } from '../../ui/MaterialSymbol.js';

export default function PriceModeSwitch() {
  const { t } = useI18n();
  const { priceMode, setPriceMode } = usePriceMode();
  return (
    <div className="price-mode-switch" role="group" aria-label={t('priceMode.label')}>
      {[PRICE_MODES.PVP, PRICE_MODES.PVE].map(mode => (
        <button
          key={mode}
          className="price-mode-switch__button"
          type="button"
          aria-pressed={priceMode === mode}
          onClick={() => setPriceMode(mode)}
        >
          <MaterialSymbol name="check" className="price-mode-switch__indicator" />
          {t(`priceMode.${mode}`)}
        </button>
      ))}
    </div>
  );
}
