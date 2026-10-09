import { useState } from 'react';
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
  dismissScope,
  t,
}) {
  // Warnings and notes can be hidden; errors explain a missing build and stay.
  // A hidden one comes back for another build (a new dismissScope) or once
  // its text changes.
  const [dismissed, setDismissed] = useState({ scope: dismissScope, keys: new Set() });
  const dismissedKeys = dismissed.scope === dismissScope ? dismissed.keys : null;
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

  const getDismissKey = notification => JSON.stringify([
    notification.id,
    notification.message,
    notification.details,
  ]);
  const dismiss = (notification, event) => {
    // Keyboard focus moves to a neighbor's close button instead of the page.
    const message = event.currentTarget.closest('.inline-message');
    const nextFocus = (message.nextElementSibling || message.previousElementSibling)
      ?.querySelector('.inline-message__dismiss');
    setDismissed(current => ({
      scope: dismissScope,
      keys: new Set([
        ...(current.scope === dismissScope ? current.keys : []),
        getDismissKey(notification),
      ]),
    }));
    if (nextFocus) requestAnimationFrame(() => nextFocus.focus());
  };

  return (
    <div className="build-warnings">
      {notifications
        .filter(notification => !dismissedKeys?.has(getDismissKey(notification)))
        .map(notification => (
          <InlineMessage
            key={notification.id}
            type={notification.type}
            title={notification.title}
            details={notification.details}
            action={notification.action}
            onDismiss={notification.type === 'error' ? null : event => dismiss(notification, event)}
            dismissLabel={t('config.notification.dismiss', { title: notification.title })}
          >
            {notification.message}
          </InlineMessage>
        ))}
    </div>
  );
}
