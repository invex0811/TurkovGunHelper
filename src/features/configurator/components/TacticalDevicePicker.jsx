import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';

function getItemLabel(item) {
  return item?.name || item?.shortName || item?.id || '';
}

const PANEL_GAP = 6;
const PANEL_MIN_HEIGHT = 140;
const PANEL_PREFERRED_HEIGHT = 290;

// The sticky header and the phone tab bar sit above the page, so the panel
// must fit between them or its search field ends up hidden underneath.
function getVisibleArea() {
  const header = document.querySelector('.topbar')?.getBoundingClientRect();
  const tabBar = document.querySelector('.topnav');
  const tabBarBounds = tabBar && getComputedStyle(tabBar).position === 'fixed'
    ? tabBar.getBoundingClientRect()
    : null;
  return {
    top: Math.max(8, (header?.bottom ?? 0) + 8),
    bottom: Math.min(window.innerHeight - 8, (tabBarBounds?.top ?? window.innerHeight) - 8),
  };
}

function getPanelPosition(bounds) {
  const area = getVisibleArea();
  const spaceBelow = area.bottom - bounds.bottom - PANEL_GAP;
  const spaceAbove = bounds.top - area.top - PANEL_GAP;
  const openUpward = spaceBelow < PANEL_PREFERRED_HEIGHT && spaceAbove > spaceBelow;
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, openUpward ? spaceAbove : spaceBelow);

  return {
    left: Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8)),
    width: Math.min(bounds.width, window.innerWidth - 16),
    maxHeight,
    ...(openUpward
      ? { bottom: Math.max(8, window.innerHeight - bounds.top + PANEL_GAP) }
      : { top: Math.min(window.innerHeight - 8, bounds.bottom + PANEL_GAP) }),
  };
}

export default function TacticalDevicePicker({
  id,
  items,
  label,
  onChange,
  selectedItemId,
  showLabel = true,
  indented = true,
  filterItems,
  panelControls,
  searchLabel,
  systemOptions,
  t,
}) {
  const listboxId = useId();
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedItemId) || null,
    [items, selectedItemId],
  );
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelPosition, setPanelPosition] = useState(null);
  const autoLabel = t('config.tactical.autoSelect');
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchingItems = !normalizedQuery ? items : items.filter(item => [item.name, item.shortName, item.id]
      .filter(Boolean)
      .some(value => value.toLocaleLowerCase().includes(normalizedQuery)));
    return filterItems ? matchingItems.filter(filterItems) : matchingItems;
  }, [filterItems, items, query]);
  const resolvedSystemOptions = systemOptions || [{
    id: null,
    label: autoLabel,
    description: t('config.tactical.autoDescription'),
  }];
  const options = [...resolvedSystemOptions, ...filteredItems.map(item => ({
    id: item.id,
    label: getItemLabel(item),
    item,
  }))];
  const selectedSystemOption = resolvedSystemOptions.find(option => option.id === selectedItemId);
  const displayedLabel = getItemLabel(selectedItem) || selectedSystemOption?.label || autoLabel;

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsidePointer = event => {
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const updatePanelPosition = () => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (bounds) setPanelPosition(getPanelPosition(bounds));
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();
  }, [isOpen]);

  const openPanel = () => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (bounds) setPanelPosition(getPanelPosition(bounds));
    setQuery('');
    setActiveIndex(0);
    setIsOpen(true);
  };

  const selectOption = option => {
    onChange(option.id);
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  return (
    <div ref={rootRef} className={`tactical-device-picker ${indented ? 'is-indented' : ''} ${isOpen ? 'is-open' : ''}`}>
      {showLabel && <label className="field-label" htmlFor={id}>{label}</label>}
      <button
        id={id}
        className="tactical-device-picker__trigger"
        type="button"
        aria-label={showLabel ? undefined : label}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        onClick={() => (isOpen ? setIsOpen(false) : openPanel())}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen) openPanel();
          } else if (event.key === 'Escape') {
            setIsOpen(false);
          }
        }}
      >
        <span className="tactical-device-picker__value">{displayedLabel}</span>
        <MaterialSymbol name="expand_more" className="tactical-device-picker__chevron" />
      </button>
      {isOpen && panelPosition && createPortal(
        <section
          ref={panelRef}
          id={listboxId}
          className="tactical-device-picker__panel"
          aria-label={label}
          style={panelPosition}
        >
          <input
            ref={searchRef}
            className="tactical-device-picker__search"
            type="search"
            aria-label={searchLabel || t('config.tactical.search')}
            placeholder={searchLabel || t('config.tactical.search')}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setIsOpen(false);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex(current => Math.min(current + 1, options.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(current => Math.max(current - 1, 0));
              } else if (event.key === 'Enter' && options[activeIndex]) {
                event.preventDefault();
                selectOption(options[activeIndex]);
              }
            }}
          />
          {panelControls}
          <div className="tactical-device-picker__options" role="listbox" aria-label={label}>
            {options.map((option, index) => (
              <button
                key={option.key || option.id || 'auto'}
                className={`tactical-device-picker__option ${option.id === selectedItemId ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                type="button"
                role="option"
                aria-selected={option.id === selectedItemId}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
                {option.id === selectedItemId && <MaterialSymbol name="check" className="tactical-device-picker__check" />}
              </button>
            ))}
            {options.length === 1 && (
              <div className="tactical-device-picker__empty" role="status">{t('config.tactical.noResults')}</div>
            )}
          </div>
        </section>,
        document.body,
      )}
    </div>
  );
}
