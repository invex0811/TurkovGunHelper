import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  MAX_COMPARE_BUILDS,
  deleteSavedBuild,
  readSavedBuilds,
} from '../data/savedBuilds.js';
import { loadItemsCatalog } from '../data/tarkovApi/index.js';
import { downloadAllBuilds, downloadBuildFile } from '../features/buildTransfer/index.js';
import BuildImportModal from '../ui/BuildImportModal.jsx';
import { useI18n } from '../i18n/useI18n.js';
import { getBuildGameMode, getLocalizedBuildWeapon } from './buildsLocalizedWeapons.js';

const METRICS = [
  { key: 'ergonomics', label: 'builds.metricErgonomics', direction: 'high' },
  { key: 'recoilVertical', label: 'builds.metricVerticalRecoil', direction: 'low' },
  { key: 'recoilHorizontal', label: 'builds.metricHorizontalRecoil', direction: 'low' },
  { key: 'weight', label: 'builds.metricWeight', direction: 'low' },
  { key: 'price', label: 'builds.metricPrice', direction: 'low' },
];

function formatSavedDate(value, language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatNumber(value, language, options) {
  return new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', options).format(Number(value) || 0);
}

function formatMetric(value, key, language, t) {
  const numericValue = Number(value) || 0;
  if (key === 'weight') return t('page.builds.weightValue', { value: formatNumber(numericValue, language, { maximumFractionDigits: 2 }) });
  if (key === 'price') return t('page.builds.priceValue', { value: formatNumber(Math.round(numericValue), language) });
  return formatNumber(numericValue, language, { maximumFractionDigits: 2 });
}

function Builds() {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [builds, setBuilds] = useState(readSavedBuilds);
  const [selectedIds, setSelectedIds] = useState([]);
  const [notice, setNotice] = useState('');
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [buildPendingDeletion, setBuildPendingDeletion] = useState(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [localizedCatalogs, setLocalizedCatalogs] = useState(() => ({
    language: null,
    byGameMode: new Map(),
  }));

  useEffect(() => {
    const handleStorage = () => setBuilds(readSavedBuilds());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const gameModes = [...new Set(builds.map(getBuildGameMode))];
    if (gameModes.length === 0) {
      return undefined;
    }

    const controller = new AbortController();
    let isCurrent = true;

    Promise.allSettled(gameModes.map(async gameMode => [
      gameMode,
      await loadItemsCatalog(gameMode, {
        priceMode: gameMode === 'pve' ? 'pve' : 'pvp',
        language,
        signal: controller.signal,
      }),
    ]))
      .then(results => {
        if (!isCurrent) return;

        setLocalizedCatalogs(previous => {
          const byGameMode = previous.language === language
            ? new Map(previous.byGameMode)
            : new Map();
          results.forEach(result => {
            if (result.status === 'fulfilled') byGameMode.set(...result.value);
          });
          return { language, byGameMode };
        });
      })
      .catch(() => {
        // allSettled normally cannot reject; retain snapshots if an unexpected error occurs.
        if (isCurrent) setLocalizedCatalogs({ language, byGameMode: new Map() });
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [builds, language]);

  useEffect(() => {
    if (!isComparisonOpen && !buildPendingDeletion) return undefined;

    const handleKeyDown = event => {
      if (event.key !== 'Escape') return;
      if (buildPendingDeletion) {
        setBuildPendingDeletion(null);
      } else {
        setIsComparisonOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [buildPendingDeletion, isComparisonOpen]);

  const selectedBuilds = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return builds.filter(build => selectedSet.has(build.id));
  }, [builds, selectedIds]);

  const displayCatalogs = localizedCatalogs.language === language
    ? localizedCatalogs.byGameMode
    : new Map();

  const openBuild = build => {
    navigate(`/configure/${encodeURIComponent(build.weapon.id)}?build=${encodeURIComponent(build.id)}`);
  };

  const toggleComparison = (event, buildId) => {
    event.stopPropagation();
    setNotice('');
    setSelectedIds(current => {
      if (current.includes(buildId)) return current.filter(id => id !== buildId);
      if (current.length >= MAX_COMPARE_BUILDS) {
        setNotice(t('builds.compareLimit', { count: MAX_COMPARE_BUILDS }));
        return current;
      }
      return [...current, buildId];
    });
  };

  const handleDelete = (event, build) => {
    event.stopPropagation();
    setBuildPendingDeletion(build);
  };

  const confirmDelete = () => {
    if (!buildPendingDeletion) return;

    deleteSavedBuild(buildPendingDeletion.id);
    setBuilds(readSavedBuilds());
    setSelectedIds(current => current.filter(id => id !== buildPendingDeletion.id));
    setBuildPendingDeletion(null);
  };

  const clearComparison = () => {
    setSelectedIds([]);
    setIsComparisonOpen(false);
    setNotice('');
  };

  const handleExport = async (event, build) => {
    event.stopPropagation();
    try {
      setNotice(t('builds.preparingExport', { name: build.name }));
      const gameMode = getBuildGameMode(build);
      const catalog = await loadItemsCatalog(gameMode, {
        priceMode: gameMode === 'pve' ? 'pve' : 'pvp',
        language,
      });
      downloadBuildFile(build, { catalog });
      setNotice(t('builds.exported', { name: build.name }));
    } catch {
      setNotice(t('builds.exportError'));
    }
  };

  const handleExportAll = async () => {
    if (builds.length === 0) return;
    try {
      setNotice(t('builds.preparingExports'));
      const modes = [...new Set(builds.map(getBuildGameMode))];
      const catalogs = new Map(await Promise.all(modes.map(async gameMode => [
        gameMode,
        await loadItemsCatalog(gameMode, { priceMode: gameMode === 'pve' ? 'pve' : 'pvp', language }),
      ])));
      downloadAllBuilds(builds, { catalogs });
      setNotice(t('builds.exportedCount', { count: builds.length }));
    } catch {
      setNotice(t('builds.exportsError'));
    }
  };

  return (
    <div className={`builds-page${selectedBuilds.length > 0 ? ' has-comparison-tray' : ''}`}>
      <section className="builds-hero">
        <div>
          <span className="builds-hero__eyebrow">{t('builds.localArmory')}</span>
          <h2>{t('builds.saved')}</h2>
          <p>{t('builds.description')}</p>
        </div>
        <div className="builds-hero__tools">
          <div className="builds-hero__count">
            <strong>{builds.length}</strong>
            <span>{t('builds.ofSaved')}</span>
          </div>
          <div className="builds-hero__actions">
            <button className="btn btn--primary" type="button" onClick={() => setIsImportOpen(true)}>{t('builds.import')}</button>
            <button className="btn btn--ghost" type="button" onClick={handleExportAll} disabled={builds.length === 0}>{t('builds.exportAll')}</button>
          </div>
        </div>
      </section>

      {notice && <div className="builds-notice" role="status">{notice}</div>}

      {builds.length === 0 ? (
        <section className="builds-empty">
          <h3>{t('builds.empty')}</h3>
          <p>{t('builds.emptyDescription')}</p>
          <Link className="btn btn--primary" to="/">{t('builds.chooseWeapon')}</Link>
        </section>
      ) : (
        <section className="build-card-grid" aria-label={t('builds.savedLabel')}>
          {builds.map(build => {
            const isSelected = selectedIds.includes(build.id);
            const displayWeapon = getLocalizedBuildWeapon(build, displayCatalogs);
            return (
              <article
                key={build.id}
                className={`build-card${isSelected ? ' is-selected' : ''}`}
                role="link"
                tabIndex={0}
                onClick={() => openBuild(build)}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openBuild(build);
                  }
                }}
              >
                <button
                  className="build-card__compare"
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={isSelected ? t('builds.removeComparison', { name: build.name }) : t('builds.addComparison', { name: build.name })}
                  onClick={event => toggleComparison(event, build.id)}
                >
                  <span aria-hidden="true">{isSelected ? '✓' : '+'}</span>
                  {isSelected ? t('builds.added') : t('builds.compare')}
                </button>

                <div className="build-card__image">
                  {build.weapon.imageUrl ? (
                    <img src={build.weapon.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span>{displayWeapon.shortName || t('builds.weapon')}</span>
                  )}
                </div>

                <div className="build-card__body">
                  <span className="build-card__weapon">{displayWeapon.shortName || displayWeapon.name || t('builds.weapon')}</span>
                  <h3 title={build.name}>{build.name}</h3>
                  <div className="build-card__meta">
                    <span>{t(build.settings.targetType === 'custom' ? 'page.builds.goalCustom' : 'page.builds.goalMeta')}</span>
                    <span>{t('builds.parts', { count: build.parts.length })}</span>
                  </div>
                  <div className="build-card__stats">
                    <span><small>{t('builds.ergo')}</small><strong>{build.stats.ergonomics}</strong></span>
                    <span><small>{t('builds.verticalRecoil')}</small><strong>{build.stats.recoilVertical}</strong></span>
                    <span><small>{t('builds.weight')}</small><strong>{formatMetric(build.stats.weight, 'weight', language, t)}</strong></span>
                  </div>
                </div>

                <div className="build-card__footer">
                  <span>{formatSavedDate(build.updatedAt, language)}</span>
                  <div className="build-card__actions">
                    <button type="button" onClick={event => handleExport(event, build)}>{t('builds.export')}</button>
                    <button className="is-danger" type="button" onClick={event => handleDelete(event, build)}>{t('builds.delete')}</button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selectedBuilds.length > 0 && (
        <aside className="comparison-tray" aria-label={t('page.builds.selectedForComparison')}>
          <div className="comparison-tray__summary">
            <span className="comparison-tray__count">{selectedBuilds.length}</span>
            <div>
              <strong>
                {selectedBuilds.length < 2
                  ? t('page.builds.selectOneMore')
                  : t('page.builds.readyToCompare', { count: selectedBuilds.length })}
              </strong>
              <span>{selectedBuilds.map(build => build.name).join(' · ')}</span>
            </div>
          </div>
          <div className="comparison-tray__actions">
            <button className="btn btn--ghost" type="button" onClick={clearComparison}>{t('builds.clear')}</button>
            <button
              className="btn btn--primary"
              type="button"
              disabled={selectedBuilds.length < 2}
              onClick={() => setIsComparisonOpen(true)}
            >
              {t('builds.compareBuilds')}
            </button>
          </div>
        </aside>
      )}

      {isComparisonOpen && selectedBuilds.length >= 2 && (
        <div className="comparison-modal" role="presentation" onMouseDown={() => setIsComparisonOpen(false)}>
          <section
            className="comparison-panel comparison-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('builds.comparison')}
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="comparison-panel__head">
              <div>
                <span className="builds-hero__eyebrow">{t('builds.comparison')}</span>
                <h2>{t('page.builds.selectedCount', { count: selectedBuilds.length })}</h2>
              </div>
              <button className="btn btn--ghost" type="button" onClick={() => setIsComparisonOpen(false)}>{t('builds.close')}</button>
            </div>
            <div className="comparison-table-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>{t('builds.metric')}</th>
                    {selectedBuilds.map(build => <th key={build.id}>{build.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(metric => {
                    const numericValues = selectedBuilds.map(build => Number(build.stats[metric.key]));
                    const bestValue = metric.direction === 'high'
                      ? Math.max(...numericValues)
                      : Math.min(...numericValues);

                    return (
                      <tr key={metric.key}>
                        <th>{t(metric.label)}</th>
                        {selectedBuilds.map(build => {
                          const value = Number(build.stats[metric.key]);
                          return (
                            <td key={build.id} className={value === bestValue ? 'is-best' : ''}>
                              {formatMetric(build.stats[metric.key], metric.key, language, t)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <th>{t('page.builds.partsMetric')}</th>
                    {selectedBuilds.map(build => <td key={build.id}>{build.parts.length}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {buildPendingDeletion && (
        <div
          className="comparison-modal"
          role="presentation"
          onMouseDown={() => setBuildPendingDeletion(null)}
        >
          <section
            className="delete-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="deleteBuildTitle"
            aria-describedby="deleteBuildDescription"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="delete-confirm__icon" aria-hidden="true">!</div>
            <div className="delete-confirm__content">
              <span className="builds-hero__eyebrow">{t('builds.deleteSaved')}</span>
              <h2 id="deleteBuildTitle">{t('page.builds.deleteTitle', { name: buildPendingDeletion.name })}</h2>
              <p id="deleteBuildDescription">
                {t('page.builds.deleteDescription')}
              </p>
            </div>
            <div className="delete-confirm__actions">
              <button className="btn btn--ghost" type="button" onClick={() => setBuildPendingDeletion(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn--danger" type="button" onClick={confirmDelete} autoFocus>
                {t('page.builds.confirmDelete')}
              </button>
            </div>
          </section>
        </div>
      )}

      {isImportOpen && (
        <BuildImportModal
          existingBuilds={builds}
          language={language}
          onClose={() => setIsImportOpen(false)}
          onImported={nextBuilds => {
            setBuilds(nextBuilds);
            setSelectedIds([]);
          }}
        />
      )}
    </div>
  );
}

export default Builds;
