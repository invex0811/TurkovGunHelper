import { useCallback, useState } from 'react';
import {
  createBuildSnapshot,
  saveBuildSnapshot,
} from '../../../data/savedBuilds.js';

export default function useSavedBuild({
  requestedSavedBuild,
  requestedSavedBuildId,
  weapon,
  buildResult,
  settings,
  t,
}) {
  const [activeSavedBuildId, setActiveSavedBuildId] = useState(requestedSavedBuildId);
  const [saveName, setSaveName] = useState(requestedSavedBuild?.name || '');
  const [saveFeedback, setSaveFeedback] = useState(null);

  const saveBuild = useCallback(() => {
    if (
      !weapon
      || !buildResult
      || buildResult.error
      || !Array.isArray(buildResult.build)
      || buildResult.build.length === 0
    ) {
      setSaveFeedback({ type: 'error', message: t('config.saveValidFirst') });
      return;
    }

    try {
      const savedBuild = saveBuildSnapshot(createBuildSnapshot({
        id: activeSavedBuildId,
        name: saveName.trim() || t('config.saveNameDefault', {
          weapon: weapon.shortName || weapon.name,
        }),
        weapon,
        buildResult,
        settings: {
          ...settings,
          customErgonomics: settings.customProfile.ergonomics,
          customVerticalRecoil: settings.customProfile.verticalRecoil,
          customHorizontalRecoil: settings.customProfile.horizontalRecoil,
          customMaxWeight: settings.customProfile.weight,
          customMaxPrice: settings.customProfile.price,
          customErgo: settings.customProfile.ergonomics,
          customRecoil: settings.customProfile.verticalRecoil,
          maxWeight: settings.customProfile.weight,
          maxPrice: settings.customProfile.price,
        },
      }));

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
  }, [activeSavedBuildId, buildResult, saveName, settings, t, weapon]);

  return {
    activeSavedBuildId,
    saveFeedback,
    saveName,
    saveBuild,
    setActiveSavedBuildId,
    setSaveFeedback,
    setSaveName,
  };
}
