import { InlineMessage } from './ConfiguratorPrimitives.jsx';

export default function BuildWarnings({
  generationError,
  pricePolicyWarning,
  replacementError,
  calculationError,
  buildWarning,
  priceWarnings,
  t,
}) {
  return (
    <>
      {generationError && (
        <InlineMessage type="error" title={t('config.generationFailedTitle')}>
          {generationError}
        </InlineMessage>
      )}
      {pricePolicyWarning && (
        <InlineMessage type="warning" title={t('config.pricePolicyTitle')}>
          {pricePolicyWarning}
        </InlineMessage>
      )}
      {replacementError && (
        <InlineMessage type="error" title={t('config.replacementRejected')}>
          {replacementError}
        </InlineMessage>
      )}
      {calculationError && (
        <InlineMessage type="error" title={t('config.constraintFailed')}>
          {calculationError}
        </InlineMessage>
      )}
      {buildWarning && (
        <InlineMessage type="warning" title={t('config.buildNotice')}>
          {buildWarning}
        </InlineMessage>
      )}
      {priceWarnings.length > 0 && (
        <InlineMessage type="warning" title={t('config.priceDataNotice')}>
          {priceWarnings.join(' ')}
        </InlineMessage>
      )}
    </>
  );
}
