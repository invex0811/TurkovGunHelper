import { Link } from 'react-router-dom';
import { formatWeaponFireModes } from '../../../domain/fireModes.js';
import { formatCaliberLabel, getWeaponTypeLabel } from '../../../pages/homeWeaponFilters.js';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';
import { TarkovDevItemLink } from '../../../ui/TarkovDevItemLink.js';

// Page header above the three columns: breadcrumbs, the weapon name, its
// tags, and the build diagram and tarkov.dev actions.
export default function ConfiguratorHero({ onOpenDiagram, t, weapon }) {
  const type = getWeaponTypeLabel(weapon);
  const caliber = weapon.properties?.caliber;
  const fireModes = formatWeaponFireModes(weapon);

  return (
    <section className="config-hero" aria-labelledby="configHeroTitle">
      <div className="config-hero__main">
        <nav className="breadcrumbs" aria-label={t('config.breadcrumbs')}>
          <ol>
            <li><Link to="/">{t('config.breadcrumbCatalog')}</Link></li>
            {type && <li>{type}</li>}
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
