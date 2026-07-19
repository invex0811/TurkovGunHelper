import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  MAX_COMPARE_BUILDS,
  deleteSavedBuild,
  readSavedBuilds,
} from '../data/savedBuilds.js';

const METRICS = [
  { key: 'ergonomics', label: 'Ergonomics', direction: 'high', format: value => value },
  { key: 'recoilVertical', label: 'Vertical recoil', direction: 'low', format: value => value },
  { key: 'recoilHorizontal', label: 'Horizontal recoil', direction: 'low', format: value => value },
  { key: 'weight', label: 'Weight', direction: 'low', format: value => `${value} kg` },
  {
    key: 'price',
    label: 'Estimated price',
    direction: 'low',
    format: value => `${Math.round(Number(value) || 0).toLocaleString()} RUB`,
  },
];

function formatSavedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getGoalLabel(targetType) {
  if (targetType === 'custom') return 'Custom';
  return 'Meta';
}

function Builds() {
  const navigate = useNavigate();
  const [builds, setBuilds] = useState(readSavedBuilds);
  const [selectedIds, setSelectedIds] = useState([]);
  const [notice, setNotice] = useState('');
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [buildPendingDeletion, setBuildPendingDeletion] = useState(null);

  useEffect(() => {
    const handleStorage = () => setBuilds(readSavedBuilds());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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

  const openBuild = build => {
    navigate(`/configure/${encodeURIComponent(build.weapon.id)}?build=${encodeURIComponent(build.id)}`);
  };

  const toggleComparison = (event, buildId) => {
    event.stopPropagation();
    setNotice('');
    setSelectedIds(current => {
      if (current.includes(buildId)) return current.filter(id => id !== buildId);
      if (current.length >= MAX_COMPARE_BUILDS) {
        setNotice(`You can compare up to ${MAX_COMPARE_BUILDS} builds at once.`);
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

  return (
    <div className={`builds-page${selectedBuilds.length > 0 ? ' has-comparison-tray' : ''}`}>
      <section className="builds-hero">
        <div>
          <span className="builds-hero__eyebrow">Local armory</span>
          <h2>Saved builds</h2>
          <p>Open a card to continue working on it, or use the hover control to add it to comparison.</p>
        </div>
        <div className="builds-hero__count">
          <strong>{builds.length}</strong>
          <span>of 100 saved</span>
        </div>
      </section>

      {notice && <div className="builds-notice" role="status">{notice}</div>}

      {builds.length === 0 ? (
        <section className="builds-empty">
          <h3>No saved builds yet</h3>
          <p>Generate a weapon build and save it. It will appear here in this browser.</p>
          <Link className="btn btn--primary" to="/">Choose a weapon</Link>
        </section>
      ) : (
        <section className="build-card-grid" aria-label="Saved weapon builds">
          {builds.map(build => {
            const isSelected = selectedIds.includes(build.id);
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
                  aria-label={isSelected ? `Remove ${build.name} from comparison` : `Add ${build.name} to comparison`}
                  onClick={event => toggleComparison(event, build.id)}
                >
                  <span aria-hidden="true">{isSelected ? '✓' : '+'}</span>
                  {isSelected ? 'Added' : 'Compare'}
                </button>

                <div className="build-card__image">
                  {build.weapon.imageUrl ? (
                    <img src={build.weapon.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span>{build.weapon.shortName || 'Weapon'}</span>
                  )}
                </div>

                <div className="build-card__body">
                  <span className="build-card__weapon">{build.weapon.shortName || build.weapon.name}</span>
                  <h3>{build.name}</h3>
                  <div className="build-card__meta">
                    <span>{getGoalLabel(build.settings.targetType)}</span>
                    <span>{build.parts.length} parts</span>
                  </div>
                  <div className="build-card__stats">
                    <span><small>Ergo</small><strong>{build.stats.ergonomics}</strong></span>
                    <span><small>V. recoil</small><strong>{build.stats.recoilVertical}</strong></span>
                    <span><small>Weight</small><strong>{build.stats.weight} kg</strong></span>
                  </div>
                </div>

                <div className="build-card__footer">
                  <span>{formatSavedDate(build.updatedAt)}</span>
                  <button type="button" onClick={event => handleDelete(event, build)}>Delete</button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selectedBuilds.length > 0 && (
        <aside className="comparison-tray" aria-label="Selected builds for comparison">
          <div className="comparison-tray__summary">
            <span className="comparison-tray__count">{selectedBuilds.length}</span>
            <div>
              <strong>
                {selectedBuilds.length < 2
                  ? 'Select one more build'
                  : `${selectedBuilds.length} builds ready`}
              </strong>
              <span>{selectedBuilds.map(build => build.name).join(' · ')}</span>
            </div>
          </div>
          <div className="comparison-tray__actions">
            <button className="btn btn--ghost" type="button" onClick={clearComparison}>Clear</button>
            <button
              className="btn btn--primary"
              type="button"
              disabled={selectedBuilds.length < 2}
              onClick={() => setIsComparisonOpen(true)}
            >
              Compare builds
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
            aria-label="Build comparison"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="comparison-panel__head">
              <div>
                <span className="builds-hero__eyebrow">Comparison</span>
                <h2>{selectedBuilds.length} builds selected</h2>
              </div>
              <button className="btn btn--ghost" type="button" onClick={() => setIsComparisonOpen(false)}>Close</button>
            </div>
            <div className="comparison-table-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Metric</th>
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
                        <th>{metric.label}</th>
                        {selectedBuilds.map(build => {
                          const value = Number(build.stats[metric.key]);
                          return (
                            <td key={build.id} className={value === bestValue ? 'is-best' : ''}>
                              {metric.format(build.stats[metric.key])}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <th>Parts</th>
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
              <span className="builds-hero__eyebrow">Delete saved build</span>
              <h2 id="deleteBuildTitle">Delete “{buildPendingDeletion.name}”?</h2>
              <p id="deleteBuildDescription">
                This build is stored only in this browser. Once deleted, it cannot be restored.
              </p>
            </div>
            <div className="delete-confirm__actions">
              <button className="btn btn--ghost" type="button" onClick={() => setBuildPendingDeletion(null)}>
                Cancel
              </button>
              <button className="btn btn--danger" type="button" onClick={confirmDelete} autoFocus>
                Delete build
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default Builds;
