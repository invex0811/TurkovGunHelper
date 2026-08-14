export function getScopeAutoCopy(t, selectedZoom) {
  if (selectedZoom === null) {
    return {
      label: t('config.tactical.autoSelect'),
      description: t('config.tactical.autoDescription'),
    };
  }

  return {
    label: t('config.sight.autoZoomLabel', { zoom: selectedZoom }),
    description: t('config.sight.autoZoomDescription', { zoom: selectedZoom }),
  };
}
