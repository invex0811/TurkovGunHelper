export const CONFIGURATOR_MESSAGE_TYPES = Object.freeze([
  'error',
  'warning',
  'info',
  'success',
]);

const BUILD_WARNING_MESSAGE_KEYS = Object.freeze({
  BASE_WEAPON_MAX_WEIGHT: 'config.warning.baseWeaponMaxWeight',
  BUILD_MAX_PRICE_EXCEEDED: 'config.warning.buildMaxPriceExceeded',
  PRICE_ITEMS_UNAVAILABLE: 'config.warning.priceItemsUnavailable',
  REQUIREMENTS_UNMET_CLOSEST_BUILD: 'config.warning.requirementsUnmet',
  SAVED_MODULES_SKIPPED: 'config.notification.warning.savedModulesSkipped',
});

const LEGACY_BUILD_WARNINGS = Object.freeze([
  {
    fallback: 'One or more selected items have no available price under the active price policy.',
    key: 'config.warning.priceItemsUnavailable',
  },
  {
    fallback: "It's physically impossible to meet your exact requirements with the current available parts. Showing the closest balanced build possible.",
    key: 'config.warning.requirementsUnmet',
  },
  {
    fallback: 'It’s physically impossible to meet your exact requirements with the current available parts. Showing the closest balanced build possible.',
    key: 'config.warning.requirementsUnmet',
  },
]);

export function normalizeNotificationText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function getSafeFallbackText(value) {
  const message = normalizeNotificationText(value);
  if (!message) return '';
  if (/^[{[]/.test(message) || /\b(?:error|exception)\b.*\bat\b/i.test(message)) return '';
  return message;
}

export function localizeBuildWarning(warning, t) {
  const warningCode = normalizeNotificationText(warning?.code);
  const messageKey = BUILD_WARNING_MESSAGE_KEYS[warningCode];

  if (messageKey) {
    const translated = normalizeNotificationText(t(messageKey, warning?.params || {}));
    if (translated && translated !== messageKey) return translated;
  }

  return getSafeFallbackText(warning?.fallback)
    || t('config.notification.buildWarningUnknown');
}

function getLegacyBuildWarnings(value) {
  const original = normalizeNotificationText(value);
  if (!original) return [];

  const matches = LEGACY_BUILD_WARNINGS
    .map(entry => ({
      ...entry,
      index: original.indexOf(entry.fallback),
    }))
    .filter(entry => entry.index >= 0)
    .sort((first, second) => first.index - second.index);

  if (matches.length === 0) return [{ fallback: original }];

  let remaining = original;
  const warnings = matches.map((entry) => {
    remaining = remaining.replace(entry.fallback, ' ');
    return { code: '', fallback: entry.fallback, key: entry.key, params: {} };
  });
  const unknownFallback = normalizeNotificationText(remaining);
  if (unknownFallback) warnings.push({ fallback: unknownFallback });
  return warnings;
}

export function getLocalizedBuildWarnings(buildResult, t) {
  let warnings;

  if (Array.isArray(buildResult?.warnings)) {
    warnings = buildResult.warnings;
  } else if (buildResult?.warningCode) {
    warnings = [{
      code: buildResult.warningCode,
      params: buildResult.warningParams || {},
      fallback: buildResult.warning,
    }];
  } else {
    warnings = getLegacyBuildWarnings(buildResult?.warning);
  }

  const localized = warnings
    .filter(Boolean)
    .map((warning) => {
      if (warning.key) {
        const translated = normalizeNotificationText(t(warning.key, warning.params || {}));
        if (translated && translated !== warning.key) return translated;
      }
      return localizeBuildWarning(warning, t);
    })
    .map(normalizeNotificationText)
    .filter(Boolean);

  return [...new Set(localized)];
}

export function getBuildResultWarningMessage(buildResult, t) {
  return getLocalizedBuildWarnings(buildResult, t)[0]
    || t('config.notification.buildWarningUnknown');
}

export function getInlineMessageA11y(type) {
  return type === 'error'
    ? { role: 'alert', ariaLive: 'assertive' }
    : { role: 'status', ariaLive: 'polite' };
}

function normalizeDetails(details) {
  const seen = new Set();
  return (Array.isArray(details) ? details : [])
    .map(normalizeNotificationText)
    .filter((detail) => {
      const key = detail.toLocaleLowerCase();
      if (!detail || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeConfiguratorNotification(notification, index = 0) {
  if (!notification) return null;

  const value = typeof notification === 'string'
    ? { message: notification }
    : notification;
  const type = CONFIGURATOR_MESSAGE_TYPES.includes(value.type) ? value.type : 'info';
  const title = normalizeNotificationText(value.title);
  const message = normalizeNotificationText(value.message);
  const details = normalizeDetails(value.details);

  if (!message && details.length === 0) return null;

  return {
    id: normalizeNotificationText(value.id) || `message-${index}`,
    type,
    title,
    message,
    details,
  };
}

export function dedupeConfiguratorNotifications(notifications) {
  const seenText = new Set();

  return (notifications || [])
    .map(normalizeConfiguratorNotification)
    .filter(Boolean)
    .map((notification) => {
      const messageKey = notification.message.toLocaleLowerCase();
      const message = messageKey && !seenText.has(messageKey)
        ? notification.message
        : '';
      if (messageKey) seenText.add(messageKey);

      const details = notification.details.filter((detail) => {
        const key = detail.toLocaleLowerCase();
        if (seenText.has(key)) return false;
        seenText.add(key);
        return true;
      });

      return { ...notification, message, details };
    })
    .filter(notification => notification.message || notification.details.length > 0);
}

export function createConfiguratorNotifications({
  generationError,
  calculationError,
  replacementError,
  buildWarning,
  buildWarnings,
  pricePolicyWarning,
  priceWarnings,
  priceInfos,
  hasFallbackPrice,
  priceModeNotice,
}, t) {
  const normalizedBuildWarnings = normalizeDetails(
    buildWarnings?.length ? buildWarnings : [buildWarning],
  );
  const notifications = [
    {
      id: 'generation-error',
      type: 'error',
      title: t('config.generationFailedTitle'),
      message: generationError,
    },
    {
      id: 'calculation-error',
      type: 'error',
      title: t('config.constraintFailed'),
      message: calculationError,
    },
    {
      id: 'replacement-error',
      type: 'error',
      title: t('config.replacementRejected'),
      message: replacementError,
    },
    {
      id: 'build-warning',
      type: 'warning',
      title: t('config.notification.buildWarningTitle'),
      message: normalizedBuildWarnings.length === 1 ? normalizedBuildWarnings[0] : '',
      details: normalizedBuildWarnings.length > 1 ? normalizedBuildWarnings : [],
    },
    {
      id: 'price-policy-warning',
      type: 'warning',
      title: t('config.notification.priceMissingTitle'),
      message: pricePolicyWarning,
    },
    {
      id: 'price-warnings',
      type: 'warning',
      title: t('config.notification.priceMissingTitle'),
      message: priceWarnings?.length
        ? t('config.notification.priceIncomplete')
        : '',
      details: priceWarnings,
    },
    {
      id: 'price-infos',
      type: 'info',
      title: hasFallbackPrice
        ? t('config.notification.priceFallbackTitle')
        : t('config.notification.priceInfoTitle'),
      message: priceInfos?.length && hasFallbackPrice
        ? t('config.notification.priceFallbackMessage')
        : '',
      details: priceInfos,
    },
    {
      id: 'price-mode-notice',
      type: 'info',
      title: t('priceMode.changed'),
      message: priceModeNotice,
    },
  ];

  return dedupeConfiguratorNotifications(notifications);
}
