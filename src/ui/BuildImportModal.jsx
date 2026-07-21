import { useEffect, useMemo, useRef, useState } from 'react';

import { importSavedBuildSnapshots } from '../data/savedBuilds.js';
import { loadItemsCatalog } from '../data/tarkovApi/index.js';
import {
  BUILD_IMPORT_LIMITS,
  DUPLICATE_STRATEGIES,
  parseBuildImport,
  prepareImportedBuilds,
} from '../features/buildTransfer/index.js';

function getStatusLabel(result) {
  if (result.status === 'ready') return 'Ready to import';
  if (result.status === 'duplicate') return 'Already exists';
  return 'Cannot import';
}

function BuildImportModal({ existingBuilds, onClose, onImported }) {
  const [phase, setPhase] = useState('select');
  const [results, setResults] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const handleKeyDown = event => {
      if (event.key === 'Escape' && phase !== 'importing') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose, phase]);

  const importableCount = useMemo(
    () => results.filter(result => result.status !== 'error' && result.strategy !== DUPLICATE_STRATEGIES.SKIP).length,
    [results],
  );

  const readFiles = async selectedFiles => {
    const files = [...selectedFiles];
    setSummary(null);
    setResults([]);
    setFileErrors([]);
    if (files.length === 0) return;
    if (files.length > BUILD_IMPORT_LIMITS.maxFiles) {
      setFileErrors([`Select no more than ${BUILD_IMPORT_LIMITS.maxFiles} files at once.`]);
      return;
    }

    setPhase('reading');
    const parsedBuilds = [];
    const nextFileErrors = [];
    await Promise.all(files.map(async file => {
      if (file.size > BUILD_IMPORT_LIMITS.maxFileBytes) {
        nextFileErrors.push(`${file.name}: file exceeds the 2 MB limit.`);
        return;
      }
      try {
        const parsed = parseBuildImport(await file.text());
        parsed.builds.forEach(build => parsedBuilds.push({ ...build, sourceFile: file.name }));
      } catch (error) {
        nextFileErrors.push(`${file.name}: ${error instanceof Error ? error.message : 'Could not read this file.'}`);
      }
    }));

    if (parsedBuilds.length > BUILD_IMPORT_LIMITS.maxBuilds) {
      nextFileErrors.push(`The selected files contain more than ${BUILD_IMPORT_LIMITS.maxBuilds} builds.`);
      parsedBuilds.length = 0;
    }
    setFileErrors(nextFileErrors);
    if (parsedBuilds.length === 0) {
      setPhase('select');
      return;
    }

    setPhase('loading');
    try {
      const modes = [...new Set(parsedBuilds.map(build => build.gameMode))];
      const catalogEntries = await Promise.all(modes.map(async gameMode => [
        gameMode,
        await loadItemsCatalog(gameMode, { priceMode: gameMode === 'pve' ? 'pve' : 'pvp' }),
      ]));
      const prepared = prepareImportedBuilds({
        builds: parsedBuilds,
        catalogs: new Map(catalogEntries),
        existingBuilds,
      }).map((result, index) => ({ ...result, key: `${index}:${result.fingerprint}` }));
      setResults(prepared);
      setPhase('ready');
    } catch (error) {
      setFileErrors(current => [...current, error instanceof Error ? error.message : 'Could not load the item catalog.']);
      setPhase('select');
    }
  };

  const updateStrategy = (key, strategy) => {
    setResults(current => current.map(result => (
      result.key === key ? { ...result, strategy } : result
    )));
  };

  const confirmImport = () => {
    if (phase === 'importing' || importableCount === 0) return;
    setPhase('importing');
    try {
      const outcome = importSavedBuildSnapshots(results);
      const failed = results.filter(result => result.status === 'error').length;
      setSummary({ imported: outcome.imported.length, skipped: outcome.skipped, failed });
      onImported(outcome.builds);
      setPhase('success');
    } catch (error) {
      setFileErrors(current => [...current, error instanceof Error ? error.message : 'The builds could not be saved.']);
      setPhase('ready');
    }
  };

  return (
    <div className="comparison-modal" role="presentation" onMouseDown={phase === 'importing' ? undefined : onClose}>
      <section
        className="build-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="buildImportTitle"
        aria-describedby="buildImportDescription"
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="build-import-modal__head">
          <div>
            <span className="builds-hero__eyebrow">Local build transfer</span>
            <h2 id="buildImportTitle">Import builds</h2>
            <p id="buildImportDescription">Choose Tarkov Gun Helper JSON files. Data is validated locally and is never uploaded.</p>
          </div>
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={phase === 'importing'}>Close</button>
        </header>

        {phase !== 'success' && (
          <div
            className={`build-import-dropzone${isDragging ? ' is-dragging' : ''}`}
            onDragEnter={event => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={event => event.preventDefault()}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
            onDrop={event => {
              event.preventDefault();
              setIsDragging(false);
              readFiles(event.dataTransfer.files);
            }}
          >
            <input
              id="buildImportFiles"
              className="visually-hidden"
              type="file"
              accept=".json,application/json"
              multiple
              onChange={event => readFiles(event.target.files)}
            />
            <label className="btn btn--primary" htmlFor="buildImportFiles">Choose JSON files</label>
            <span>or drag and drop up to {BUILD_IMPORT_LIMITS.maxFiles} files here</span>
          </div>
        )}

        {(phase === 'reading' || phase === 'loading') && (
          <div className="build-import-progress" role="status">
            <span className="spinner" aria-hidden="true" />
            {phase === 'reading' ? 'Reading and validating files…' : 'Loading current item catalogs…'}
          </div>
        )}

        {fileErrors.length > 0 && (
          <div className="build-import-errors" role="alert" aria-live="assertive">
            <strong>Some files could not be processed</strong>
            <ul>{fileErrors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
          </div>
        )}

        {results.length > 0 && phase !== 'success' && (
          <div className="build-import-preview" aria-label="Build import preview">
            {results.map(result => (
              <article className={`build-import-row is-${result.status}`} key={result.key}>
                <div className="build-import-row__main">
                  <div>
                    <strong>{result.build.name}</strong>
                    <span>{result.weaponName || result.build.weaponId} · {result.build.gameMode === 'pve' ? 'PvE' : 'PvP'} · {result.moduleCount} modules</span>
                  </div>
                  <span className="build-import-status">{getStatusLabel(result)}</span>
                </div>
                {(result.errors.length > 0 || result.warnings.length > 0) && (
                  <ul className="build-import-row__messages">
                    {[...result.errors, ...result.warnings].map(message => <li key={message}>{message}</li>)}
                  </ul>
                )}
                {result.status !== 'error' && (
                  <label className="build-import-row__strategy">
                    <span>{result.status === 'duplicate' ? 'Duplicate action' : 'Import action'}</span>
                    <select value={result.strategy} onChange={event => updateStrategy(result.key, event.target.value)}>
                      <option value={DUPLICATE_STRATEGIES.SKIP}>Skip</option>
                      <option value={DUPLICATE_STRATEGIES.COPY}>{result.status === 'duplicate' ? 'Import a copy' : 'Import'}</option>
                      {result.status === 'duplicate' && result.duplicateOf?.id && (
                        <option value={DUPLICATE_STRATEGIES.REPLACE}>Replace existing build</option>
                      )}
                    </select>
                  </label>
                )}
              </article>
            ))}
          </div>
        )}

        {phase === 'success' && summary && (
          <div className="build-import-success" role="status">
            <strong>Import complete</strong>
            <span>{summary.imported} imported · {summary.skipped} skipped · {summary.failed} with errors</span>
          </div>
        )}

        <footer className="build-import-modal__actions">
          {phase === 'success' ? (
            <button className="btn btn--primary" type="button" onClick={onClose} autoFocus>Done</button>
          ) : (
            <>
              <button className="btn btn--ghost" type="button" onClick={onClose} disabled={phase === 'importing'}>Cancel</button>
              <button className="btn btn--primary" type="button" onClick={confirmImport} disabled={phase !== 'ready' || importableCount === 0}>
                {phase === 'importing' ? 'Importing…' : `Import ${importableCount || ''}`.trim()}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

export default BuildImportModal;
