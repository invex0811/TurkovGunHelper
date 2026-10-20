import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { isAbortError, loadWeaponSlugIndex } from '../../data/tarkovApi/index.js';
import { getWeaponPath } from '../../domain/weaponSlugs.js';
import { useI18n } from '../../i18n/useI18n.js';
import { usePriceMode } from '../priceMode/usePriceMode.js';
import { applyPageMeta } from '../seo/documentMeta.js';
import { describeWeapon, getAmbiguousShortNames, getWeaponPageMeta, NOT_FOUND_META } from '../seo/pageMeta.js';

// The slug index of the current catalog. A language or price mode switch keeps
// the previous index until the next one arrives, so the page never drops back
// to a loader (slugs do not depend on either).
function useWeaponSlugIndex() {
  const { language } = useI18n();
  const { priceMode } = usePriceMode();
  const [state, setState] = useState({ index: null, failed: false });

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;
    loadWeaponSlugIndex({ priceMode, language, signal: controller.signal }).then(
      index => {
        if (isCurrent) setState({ index, failed: false });
      },
      error => {
        if (isCurrent && !isAbortError(error)) setState(previous => ({ ...previous, failed: true }));
      },
    );
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [language, priceMode]);

  return state;
}

function RedirectToWeapon({ slug }) {
  const location = useLocation();
  return (
    <Navigate
      replace
      to={{ pathname: getWeaponPath(slug), search: location.search, hash: location.hash }}
      state={location.state}
    />
  );
}

// /weapon/:slug/ — finds the weapon id for the configurator. A slug the
// catalog does not know goes to the configurator as is, which shows its
// "not found" (or, offline, its loading error) state.
export function WeaponRoute({ fallback, children }) {
  const { slug = '' } = useParams();
  const { index, failed } = useWeaponSlugIndex();
  const weaponId = index?.idBySlug.get(slug) ?? null;
  // An id in place of the slug: an old or hand-typed link.
  const canonicalSlug = !weaponId ? index?.slugById.get(slug) ?? null : null;
  const weapon = weaponId ? index.weaponById.get(weaponId) : null;
  const ambiguousShortNames = useMemo(
    () => getAmbiguousShortNames([...(index?.weaponById.values() ?? [])].map(describeWeapon)),
    [index],
  );

  // Known catalog, no such slug or id: the configurator shows "not found".
  const isUnknown = Boolean(index) && !weaponId && !canonicalSlug;

  useEffect(() => {
    if (weapon) applyPageMeta(getWeaponPageMeta({ ...describeWeapon(weapon), slug }, { ambiguousShortNames }));
    else if (isUnknown) applyPageMeta(NOT_FOUND_META);
  }, [ambiguousShortNames, isUnknown, slug, weapon]);

  if (canonicalSlug) return <RedirectToWeapon slug={canonicalSlug} />;
  if (weaponId) return children(weaponId);
  if (index || failed) return children(slug);
  return fallback;
}

// /configure/:weaponId — the old configurator address. Redirects to the
// weapon page with the query (?build=…) and navigation state kept. A weapon
// without a slug opens here, as before.
export function LegacyConfigureRoute({ fallback, children }) {
  const { weaponId = '' } = useParams();
  const { index, failed } = useWeaponSlugIndex();
  const slug = index?.slugById.get(weaponId) ?? null;

  if (slug) return <RedirectToWeapon slug={slug} />;
  if (index || failed) return children(weaponId);
  return fallback;
}
