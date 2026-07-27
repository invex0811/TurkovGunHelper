import { useI18n } from '../../../i18n/useI18n.js';
import { formatCurrency, formatPriceSource } from '../formatters.js';

export function ItemPrice({ priceInfo, className = '' }) {
  const { t } = useI18n();
  const sourceLabel = formatPriceSource(priceInfo, t);
  return (
    <span className={`item-price ${className}`.trim()}>
      <strong>
        {formatCurrency(priceInfo?.value, priceInfo?.currency, t('config.notAvailable'))}
      </strong>
      {sourceLabel && <span className="item-price__source">{sourceLabel}</span>}
    </span>
  );
}

export function PriceSource({ priceInfo }) {
  const { t } = useI18n();
  const sourceLabel = formatPriceSource(priceInfo, t);
  return sourceLabel
    ? <span className="item-price__source">{sourceLabel}</span>
    : null;
}
