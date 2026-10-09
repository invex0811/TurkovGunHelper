import { InlineMessage } from './ConfiguratorPrimitives.jsx';
import { createConfiguratorNotifications } from '../configuratorNotifications.js';

export default function BuildWarnings({
  generationError,
  calculationError,
  calculationErrorAction,
  replacementError,
  buildWarnings,
  pricePolicyWarning,
  priceWarnings,
  priceInfos,
  hasFallbackPrice,
  priceModeNotice,
  t,
}) {
  const notifications = createConfiguratorNotifications({
    generationError,
    calculationError,
    calculationErrorAction,
    replacementError,
    buildWarnings,
    pricePolicyWarning,
    priceWarnings,
    priceInfos,
    hasFallbackPrice,
    priceModeNotice,
  }, t);

  return (
    <div className="build-warnings">
      {notifications.map(notification => (
        <InlineMessage
          key={notification.id}
          type={notification.type}
          title={notification.title}
          details={notification.details}
          action={notification.action}
        >
          {notification.message}
        </InlineMessage>
      ))}
    </div>
  );
}
