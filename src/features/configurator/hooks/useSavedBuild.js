import { useCallback, useState } from 'react';
import {
  createBuildSnapshot,
  saveBuildSnapshot,
} from '../../../data/savedBuilds.js';
import {
  copyTextToClipboard,
  createBuildShareUrl,
  encodeBuildShareParam,
} from '../../buildTransfer/index.js';

function hasValidBuild(weapon, buildResult) {
  return Boolean(weapon)
    && Boolean(buildResult)
    && !buildResult.error
    && Array.isArray(buildResult.build)
    && buildResult.build.length > 0;
}

export default function useSavedBuild({
  requestedSavedBuild,
  requestedSavedBuildId,
  weapon,
  buildResult,
  settings,
  ownedItems,
  t,
}) {
  const [activeSavedBuildId, setActiveSavedBuildId] = useState(requestedSavedBuildId);
  const [saveName, setSaveName] = useState(requestedSavedBuild?.name || '');
  const [saveFeedback, setSaveFeedback] = useState(null);

  const createCurrentSnapshot = useCallback(id => createBuildSnapshot({
    id,
    name: saveName.trim() || t('config.saveNameDefault', {
      weapon: weapon.shortName || weapon.name,
    }),
    weapon,
    buildResult,
    settings: {
      ...settings,
      customProfile: {
        ...settings.customProfile,
        price: settings.maxPrice,
      },
      sharedMaxPrice: settings.maxPrice,
      priorityMaxPrice: settings.maxPrice,
      customErgonomics: settings.customProfile.ergonomics,
      customVerticalRecoil: settings.customProfile.verticalRecoil,
      customHorizontalRecoil: settings.customProfile.horizontalRecoil,
      customMaxWeight: settings.customProfile.weight,
      customMaxPrice: settings.maxPrice,
      customErgo: settings.customProfile.ergonomics,
      customRecoil: settings.customProfile.verticalRecoil,
      maxWeight: settings.customProfile.weight,
      maxPrice: settings.maxPrice,
    },
    ownedItems,
  }), [buildResult, ownedItems, saveName, settings, t, weapon]);

  const saveBuild = useCallback(() => {
    if (!hasValidBuild(weapon, buildResult)) {
      setSaveFeedback({ type: 'error', message: t('config.saveValidFirst') });
      return;
    }

    try {
      const savedBuild = saveBuildSnapshot(createCurrentSnapshot(activeSavedBuildId));

      setActiveSavedBuildId(savedBuild.id);
      setSaveName(savedBuild.name);
      setSaveFeedback({
        type: 'success',
        message: activeSavedBuildId ? t('config.saveUpdated') : t('config.saveLocal'),
      });
    } catch {
      setSaveFeedback({
        type: 'error',
        message: t('config.saveFailed'),
      });
    }
  }, [activeSavedBuildId, buildResult, createCurrentSnapshot, t, weapon]);

  // Shares what is on screen, saved or not; the recipient decides whether to keep it.
  const shareBuild = useCallback(async () => {
    if (!hasValidBuild(weapon, buildResult)) {
      setSaveFeedback({ type: 'error', title: t('config.shareFailedTitle'), message: t('config.shareValidFirst') });
      return;
    }

    try {
      const snapshot = createCurrentSnapshot(activeSavedBuildId);
      await copyTextToClipboard(encodeBuildShareParam(snapshot).then(param => createBuildShareUrl(param)));
      setSaveFeedback({ type: 'success', title: t('config.shareCopiedTitle'), message: t('config.shareCopied') });
    } catch {
      setSaveFeedback({ type: 'error', title: t('config.shareFailedTitle'), message: t('config.shareFailed') });
    }
  }, [activeSavedBuildId, buildResult, createCurrentSnapshot, t, weapon]);

  return {
    activeSavedBuildId,
    saveFeedback,
    saveName,
    saveBuild,
    shareBuild,
    setActiveSavedBuildId,
    setSaveFeedback,
    setSaveName,
  };
}
