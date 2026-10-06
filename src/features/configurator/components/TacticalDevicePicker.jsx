import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';

function getItemLabel(item) {
  return item?.name || item?.shortName || item?.id || '';
}

const PANEL_GAP = 6;
const PANEL_MIN_HEIGHT = 140;
const PANEL_PREFERRED_HEIGHT = 290;
// Wider than the sidebar trigger so long item names fit on one line.
const PANEL_MIN_WIDTH = 360;

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
  const width = Math.min(Math.max(bounds.width, PANEL_MIN_WIDTH), window.innerWidth - 16);

  return {
    left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
    width,
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
  getItemBadge,
  panelControls,
  searchLabel,
  systemOptions,
  t,
}) {
  const listboxId = useId();
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const scrollActiveIntoViewRef = useRef(false);
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
  const isFiltered = filteredItems.length !== items.length;

  useEffect(() => {
    if (!scrollActiveIntoViewRef.current) return;
    scrollActiveIntoViewRef.current = false;
    panelRef.current
      ?.querySelector(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

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

  const moveActiveIndex = step => {
    scrollActiveIntoViewRef.current = true;
    setActiveIndex(current => Math.min(Math.max(current + step, 0), options.length - 1));
  };

  const renderOption = (option, index) => {
    const isSelected = option.id === selectedItemId;
    const badge = option.item && getItemBadge?.(option.item);
    return (
      <button
        key={option.key || option.id || 'auto'}
        className={`tactical-device-picker__option ${option.item ? 'has-icon' : ''} ${isSelected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        data-option-index={index}
        onMouseMove={() => setActiveIndex(index)}
        onClick={() => selectOption(option)}
      >
        {option.item && (
          <span className="tactical-device-picker__icon">
            {option.item.iconLink && <img src={option.item.iconLink} alt="" loading="lazy" decoding="async" />}
          </span>
        )}
        <span className="tactical-device-picker__text">
          <span className="tactical-device-picker__label">{option.label}</span>
          {option.description && <small>{option.description}</small>}
        </span>
        {badge && <span className="tactical-device-picker__badge">{badge}</span>}
        {isSelected && <MaterialSymbol name="check" className="tactical-device-picker__check" />}
      </button>
    );
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
          onKeyDown={event => {
            // Handled on the panel so Escape also works from the filter chips.
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setIsOpen(false);
            rootRef.current?.querySelector('.tactical-device-picker__trigger')?.focus();
          }}
        >
          <span className="tactical-device-picker__search-field">
            <MaterialSymbol name="search" className="tactical-device-picker__search-icon" />
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
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveActiveIndex(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveActiveIndex(-1);
                } else if (event.key === 'Enter' && options[activeIndex]) {
                  event.preventDefault();
                  selectOption(options[activeIndex]);
                }
              }}
            />
          </span>
          {panelControls}
          <div className="tactical-device-picker__listbox" role="listbox" aria-label={label}>
            <div className="tactical-device-picker__system" role="group">
              {resolvedSystemOptions.map(renderOption)}
            </div>
            <div className="tactical-device-picker__count" aria-live="polite">
              {isFiltered
                ? t('config.tactical.countFiltered', { count: filteredItems.length, total: items.length })
                : t('config.tactical.countAll', { total: items.length })}
            </div>
            <div className="tactical-device-picker__options" role="group">
              {options.slice(resolvedSystemOptions.length).map((option, offset) => (
                renderOption(option, resolvedSystemOptions.length + offset)
              ))}
              {filteredItems.length === 0 && (
                <div className="tactical-device-picker__empty" role="status">{t('config.tactical.noResults')}</div>
              )}
            </div>
          </div>
        </section>,
        document.body,
      )}
    </div>
  );
}
