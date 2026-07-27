import { useEffect, useRef } from 'react';
import {
  getAllMods,
  getWeaponDetails,
  isAbortError,
} from '../../../data/tarkovApi/index.js';

export default function useConfiguratorCatalog({
  weaponId,
  priceMode,
  savedBuildId,
  language,
  onLoading,
  onLoaded,
  onError,
}) {
  const handlersRef = useRef({ onLoading, onLoaded, onError });
  const lastLoadedRequestRef = useRef(null);
  const lastLoadedWeaponRef = useRef(null);

  useEffect(() => {
    handlersRef.current = { onLoading, onLoaded, onError };
  }, [onError, onLoaded, onLoading]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const previousRequest = lastLoadedRequestRef.current;
    const isCatalogReload = Boolean(
      previousRequest
      && previousRequest.weaponId === weaponId
      && previousRequest.savedBuildId === savedBuildId,
    );
    const reloadReason = isCatalogReload && previousRequest.priceMode !== priceMode
      ? 'price-mode'
      : isCatalogReload ? 'catalog' : 'initial';

    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        handlersRef.current.onLoading({ isCatalogReload, reloadReason });
        return Promise.all([
          getWeaponDetails(weaponId, priceMode, {
            signal: controller.signal,
            language,
          }),
          getAllMods(priceMode, {
            signal: controller.signal,
            language,
          }),
        ]);
      })
      .then(result => {
        if (cancelled || !result) return;

        const [weapon, allMods] = result;
        handlersRef.current.onLoaded({
          weapon,
          allMods,
          isCatalogReload,
          reloadReason,
          previousWeapon: lastLoadedWeaponRef.current,
        });
        lastLoadedRequestRef.current = {
          weaponId,
          savedBuildId,
          priceMode,
          language,
        };
        lastLoadedWeaponRef.current = weapon;
      })
      .catch(error => {
        if (cancelled || controller.signal.aborted || isAbortError(error)) return;
        handlersRef.current.onError(error, { isCatalogReload, reloadReason });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [language, priceMode, savedBuildId, weaponId]);
}
