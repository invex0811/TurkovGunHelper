import { useEffect, useMemo, useRef, useState } from 'react';

import { importSavedBuildSnapshots } from '../data/savedBuilds.js';
import { loadItemsCatalog } from '../data/tarkovApi/index.js';
import {
  BUILD_IMPORT_LIMITS,
  DUPLICATE_STRATEGIES,
  parseBuildImport,
  prepareImportedBuilds,
} from '../features/buildTransfer/index.js';
import { useI18n } from '../i18n/useI18n.js';

function getGameModeLabel(gameMode, t) {
  return gameMode === 'pve' ? t('page.import.modePve') : t('page.import.modePvp');
}

function formatImportIssue(issue, t) {
  const message = String(issue || '');
  let match = message.match(/^Weapon (.+) is not available in this catalog\.$/);
  if (match) return t('page.import.issue.weaponUnavailable', { id: match[1] });

  match = message.match(/^Item (.+) is not a weapon\.$/);
  if (match) return t('page.import.issue.itemNotWeapon', { id: match[1] });

  match = message.match(/^(.+): item (.+) is not available in the (regular|pve) catalog\.$/);
  if (match) return t('page.import.issue.itemUnavailable', {
    path: match[1],
    id: match[2],
    mode: getGameModeLabel(match[3], t),
  });

  match = message.match(/^(.+): slot (.+) was not found on (.+)\.$/);
  if (match) return t('page.import.issue.slotNotFound', {
    path: match[1],
    slot: match[2],
    parent: match[3],
  });

  match = message.match(/^(.+): (.+) is not allowed in slot (.+)\.$/);
  if (match) return t('page.import.issue.itemNotAllowed', {
    path: match[1],
    item: match[2],
    slot: match[3],
  });

  match = message.match(/^(.+) is installed more than once\.$/);
  if (match) return t('page.import.issue.duplicateItem', { item: match[1] });

  match = message.match(/^(.+): required slot (.+) \((.+)\) is empty\.$/);
  if (match) return t('page.import.issue.requiredSlotEmpty', {
    path: match[1],
    slot: match[2],
    name: match[3],
  });

  match = message.match(/^The (regular|pve) item catalog could not be loaded\.$/);
  if (match) return t('page.import.issue.catalogUnavailable', { mode: getGameModeLabel(match[1], t) });

  match = message.match(/^Already saved as "(.+)"\.$/);
  if (match) return t('page.import.issue.alreadySaved', { name: match[1] });

  if (message === 'This module is already installed in the build.') {
    return t('page.import.issue.moduleAlreadyInstalled');
  }

  match = message.match(/^(.+) conflicts with (.+)\.$/);
  if (match) return t('page.import.issue.itemsConflict', { first: match[1], second: match[2] });

  if (message === 'After this change, one or more modules will lose their compatible parent slot.') {
    return t('page.import.issue.unattachedModule');
  }

  return t('page.import.issue.details', { message });
}

function shouldResetImportForLanguageChange(phase) {
  return phase === 'reading' || phase === 'loading' || phase === 'ready';
}

function BuildImportModal({ existingBuilds, language, onClose, onImported }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('select');
  const [results, setResults] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dialogRef = useRef(null);
  const importRequestIdRef = useRef(0);
  const previousLanguageRef = useRef(language);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const languageChanged = previousLanguageRef.current !== language;
    previousLanguageRef.current = language;
    const invalidatedRequestId = ++importRequestIdRef.current;
    const shouldReset = languageChanged && shouldResetImportForLanguageChange(phaseRef.current);
    const resetTimer = shouldReset
      ? window.setTimeout(() => {
        if (importRequestIdRef.current !== invalidatedRequestId) return;
        setResults([]);
        setFileErrors([]);
        setSummary(null);
        setPhase('select');
      }, 0)
      : null;
    return () => {
      if (resetTimer !== null) window.clearTimeout(resetTimer);
      importRequestIdRef.current += 1;
    };
  }, [language]);

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

  const getStatusLabel = status => {
    if (status === 'ready') return t('page.import.statusReady');
    if (status === 'duplicate') return t('page.import.statusDuplicate');
    return t('page.import.statusError');
  };

  const readFiles = async selectedFiles => {
    const requestId = ++importRequestIdRef.current;
    const isCurrentRequest = () => importRequestIdRef.current === requestId;
    const files = [...selectedFiles];
    setSummary(null);
    setResults([]);
    setFileErrors([]);
    if (files.length === 0) return;
    if (files.length > BUILD_IMPORT_LIMITS.maxFiles) {
      setFileErrors([t('page.import.tooManyFiles', { count: BUILD_IMPORT_LIMITS.maxFiles })]);
      return;
    }

    setPhase('reading');
    const parsedBuilds = [];
    const nextFileErrors = [];
    await Promise.all(files.map(async file => {
      if (file.size > BUILD_IMPORT_LIMITS.maxFileBytes) {
        nextFileErrors.push(t('page.import.fileTooLarge', {
          name: file.name,
          size: Math.round(BUILD_IMPORT_LIMITS.maxFileBytes / (1024 * 1024)),
        }));
        return;
      }
      try {
        const parsed = parseBuildImport(await file.text());
        parsed.builds.forEach(build => parsedBuilds.push({ ...build, sourceFile: file.name }));
      } catch {
        nextFileErrors.push(t('page.import.fileInvalid', { name: file.name }));
      }
    }));

    if (!isCurrentRequest()) return;

    if (parsedBuilds.length > BUILD_IMPORT_LIMITS.maxBuilds) {
      nextFileErrors.push(t('page.import.tooManyBuilds', { count: BUILD_IMPORT_LIMITS.maxBuilds }));
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
        await loadItemsCatalog(gameMode, { priceMode: gameMode === 'pve' ? 'pve' : 'pvp', language }),
      ]));
      const prepared = prepareImportedBuilds({
        builds: parsedBuilds,
        catalogs: new Map(catalogEntries),
        existingBuilds,
      }).map((result, index) => ({ ...result, key: `${index}:${result.fingerprint}` }));
      if (!isCurrentRequest()) return;
      setResults(prepared);
      setPhase('ready');
    } catch {
      if (!isCurrentRequest()) return;
      setFileErrors(current => [...current, t('error.load')]);
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
    } catch {
      setFileErrors(current => [...current, t('error.load')]);
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
            <span className="builds-hero__eyebrow">{t('import.eyebrow')}</span>
            <h2 id="buildImportTitle">{t('import.title')}</h2>
            <p id="buildImportDescription">{t('import.description')}</p>
          </div>
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={phase === 'importing'}>{t('common.close')}</button>
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
              onChange={event => {
                readFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <label className="btn btn--primary" htmlFor="buildImportFiles">{t('import.choose')}</label>
            <span>{t('import.drop', { count: BUILD_IMPORT_LIMITS.maxFiles })}</span>
          </div>
        )}

        {(phase === 'reading' || phase === 'loading') && (
          <div className="build-import-progress" role="status">
            <span className="spinner" aria-hidden="true" />
            {phase === 'reading' ? t('import.reading') : t('import.loading')}
          </div>
        )}

        {fileErrors.length > 0 && (
          <div className="build-import-errors" role="alert" aria-live="assertive">
            <strong>{t('import.errors')}</strong>
            <ul>{fileErrors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
          </div>
        )}

        {results.length > 0 && phase !== 'success' && (
          <div className="build-import-preview" aria-label={t('import.preview')}>
            {results.map(result => (
              <article className={`build-import-row is-${result.status}`} key={result.key}>
                <div className="build-import-row__main">
                  <div>
                    <strong>{result.build.name}</strong>
                    <span>{t('page.import.gameMode', {
                      weapon: result.weaponName || result.build.weaponId,
                      mode: result.build.gameMode === 'pve' ? 'PvE' : 'PvP',
                      count: result.moduleCount,
                    })}</span>
                  </div>
                  <span className="build-import-status">{getStatusLabel(result.status)}</span>
                </div>
                {(result.errors.length > 0 || result.warnings.length > 0) && (
                  <ul className="build-import-row__messages">
                    {result.errors.map((error, index) => <li key={`error:${index}`}>{formatImportIssue(error, t)}</li>)}
                    {result.warnings.map((warning, index) => <li key={`warning:${index}`}>{formatImportIssue(warning, t)}</li>)}
                  </ul>
                )}
                {result.status !== 'error' && (
                  <label className="build-import-row__strategy">
                    <span>{result.status === 'duplicate' ? t('import.strategyDuplicate') : t('import.strategyImport')}</span>
                    <select value={result.strategy} onChange={event => updateStrategy(result.key, event.target.value)}>
                      <option value={DUPLICATE_STRATEGIES.SKIP}>{t('import.skip')}</option>
                      <option value={DUPLICATE_STRATEGIES.COPY}>{result.status === 'duplicate' ? t('page.import.copy') : t('page.import.import')}</option>
                      {result.status === 'duplicate' && result.duplicateOf?.id && (
                        <option value={DUPLICATE_STRATEGIES.REPLACE}>{t('import.replace')}</option>
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
            <strong>{t('import.complete')}</strong>
            <span>{t('import.summary', summary)}</span>
          </div>
        )}

        <footer className="build-import-modal__actions">
          {phase === 'success' ? (
            <button className="btn btn--primary" type="button" onClick={onClose} autoFocus>{t('import.done')}</button>
          ) : (
            <>
              <button className="btn btn--ghost" type="button" onClick={onClose} disabled={phase === 'importing'}>{t('common.cancel')}</button>
              <button className="btn btn--primary" type="button" onClick={confirmImport} disabled={phase !== 'ready' || importableCount === 0}>
                {phase === 'importing' ? t('import.importing') : t('import.submit', { count: importableCount })}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

export default BuildImportModal;
