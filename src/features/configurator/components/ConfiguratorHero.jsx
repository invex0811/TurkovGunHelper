import { Link } from 'react-router-dom';
import { formatWeaponFireModes } from '../../../domain/fireModes.js';
import {
  formatCaliberLabel,
  getHomeTypeFilterPath,
  getWeaponTypeLabel,
} from '../../../pages/homeWeaponFilters.js';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';
import { useFavoriteWeapons } from '../../favorites/useFavoriteWeapons.js';
import { TarkovDevItemLink } from '../../../ui/TarkovDevItemLink.js';

// Page header above the three columns: breadcrumbs, the weapon name, its
// tags, and the favorite, build diagram and tarkov.dev actions.
export default function ConfiguratorHero({ onOpenDiagram, t, weapon }) {
  const { isFavoriteWeapon, toggleFavoriteWeapon } = useFavoriteWeapons();
  const isFavorite = isFavoriteWeapon(weapon.id);
  const weaponName = weapon.name || weapon.shortName;
  const type = getWeaponTypeLabel(weapon);
  const caliber = weapon.properties?.caliber;
  const fireModes = formatWeaponFireModes(weapon);

  return (
    <section className="config-hero" aria-labelledby="configHeroTitle">
      <div className="config-hero__main">
        <nav className="breadcrumbs" aria-label={t('config.breadcrumbs')}>
          <ol>
            <li><Link to="/">{t('config.breadcrumbCatalog')}</Link></li>
            {type && <li><Link to={getHomeTypeFilterPath(type)}>{type}</Link></li>}
            <li aria-current="page">{weapon.shortName}</li>
          </ol>
        </nav>
        <div className="config-hero__title">
          <h1 id="configHeroTitle">{weapon.shortName}</h1>
          {weapon.name && weapon.name !== weapon.shortName && (
            <p className="config-hero__full-name">{weapon.name}</p>
          )}
        </div>
        <ul className="config-hero__tags" aria-label={t('config.weaponTags')}>
          {caliber && <li className="tag tag--gold">{formatCaliberLabel(caliber)}</li>}
          {type && <li className="tag">{type}</li>}
          {fireModes && <li className="tag">{fireModes}</li>}
        </ul>
      </div>
      <div className="config-hero__actions">
        <button
          className={`btn btn--ghost favorite-btn${isFavorite ? ' is-active' : ''}`}
          type="button"
          aria-pressed={isFavorite}
          title={t(isFavorite ? 'favorite.remove' : 'favorite.add', { weapon: weaponName })}
          onClick={() => toggleFavoriteWeapon(weapon.id)}
        >
          <MaterialSymbol name="star" className="btn__icon btn__icon--gold" />
          <span className="favorite-btn__label">{t('favorite.button')}</span>
        </button>
        <button className="btn btn--ghost" type="button" onClick={onOpenDiagram}>
          <MaterialSymbol name="account_tree" className="btn__icon btn__icon--gold" />
          {t('config.diagram')}
        </button>
        <TarkovDevItemLink
          weapon={weapon}
          title={t('config.tarkovDevLinkTitle')}
          ariaLabel={t('config.tarkovDevLinkAria', {
            weapon: weapon.name || weapon.shortName || t('config.weapon'),
          })}
          fallbackWeaponName={t('config.weapon')}
        />
      </div>
    </section>
  );
}
