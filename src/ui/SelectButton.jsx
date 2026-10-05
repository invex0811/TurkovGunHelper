import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { MaterialSymbol } from './MaterialSymbol.js';

const LIST_GAP = 6;
const LIST_MAX_HEIGHT = 320;
const TYPEAHEAD_RESET_MS = 600;

// The list is portaled to <body> with fixed coordinates, so scrollable
// parents (a dialog body) do not clip it. It flips up when there is no room.
function getListPosition(bounds) {
  const spaceBelow = window.innerHeight - bounds.bottom - LIST_GAP - 8;
  const spaceAbove = bounds.top - LIST_GAP - 8;
  const openUpward = spaceBelow < Math.min(LIST_MAX_HEIGHT, 200) && spaceAbove > spaceBelow;
  return {
    left: bounds.left,
    width: bounds.width,
    maxHeight: Math.min(LIST_MAX_HEIGHT, openUpward ? spaceAbove : spaceBelow),
    ...(openUpward
      ? { bottom: window.innerHeight - bounds.top + LIST_GAP }
      : { top: bounds.bottom + LIST_GAP }),
  };
}

function isSamePosition(left, right) {
  if (!left || !right) return false;
  const keys = ['left', 'width', 'maxHeight', 'top', 'bottom'];
  return keys.every(key => left[key] === right[key]);
}

// A field-styled dropdown with a themed option list. The native select popup
// cannot be styled, so this follows the listbox pattern: the trigger opens the
// list, focus moves to it, arrows and typed letters move the highlight.
//
// With `label`, the label is shown inside the field ("Sort: by name"). With
// `labelId`, an external element labels it, as in a form.
function SelectButton({ className = '', disabled = false, id, label, labelId, options, value, onChange }) {
  const listId = useId();
  const valueId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typeaheadRef = useRef({ text: '', timer: null });
  const scrollToActiveRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState(null);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));

  useEffect(() => {
    if (!isOpen) return undefined;
    listRef.current?.focus();
    const closeOnOutsidePointer = event => {
      if (!rootRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    // Only page or dialog scrolling moves the trigger. The capturing listener
    // also hears the list's own scroll, which must not re-render every frame.
    const updatePosition = event => {
      if (event?.type === 'scroll' && listRef.current?.contains(event.target)) return;
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const next = getListPosition(bounds);
      setPosition(current => (isSamePosition(current, next) ? current : next));
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Keyboard moves scroll the highlight into view; hovering must not, or the
  // list jumps under the pointer.
  useLayoutEffect(() => {
    if (!isOpen || !scrollToActiveRef.current) return;
    scrollToActiveRef.current = false;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen, listId]);

  const highlight = index => {
    scrollToActiveRef.current = true;
    setActiveIndex(index);
  };

  useEffect(() => () => clearTimeout(typeaheadRef.current.timer), []);

  const open = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) setPosition(getListPosition(bounds));
    highlight(selectedIndex);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const choose = index => {
    onChange(options[index].value);
    close();
  };

  // Typing letters jumps to the next option whose label starts with them.
  const typeahead = character => {
    const state = typeaheadRef.current;
    clearTimeout(state.timer);
    state.text += character.toLocaleLowerCase();
    state.timer = setTimeout(() => { state.text = ''; }, TYPEAHEAD_RESET_MS);
    const start = state.text.length === 1 ? activeIndex + 1 : activeIndex;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length;
      if (options[index].label.toLocaleLowerCase().startsWith(state.text)) {
        highlight(index);
        return;
      }
    }
  };

  const handleListKeyDown = event => {
    const lastIndex = options.length - 1;
    const moves = {
      ArrowDown: Math.min(activeIndex + 1, lastIndex),
      ArrowUp: Math.max(activeIndex - 1, 0),
      Home: 0,
      End: lastIndex,
      PageDown: Math.min(activeIndex + 10, lastIndex),
      PageUp: Math.max(activeIndex - 10, 0),
    };
    if (event.key in moves) {
      event.preventDefault();
      highlight(moves[event.key]);
    } else if (event.key === 'Enter' || (event.key === ' ' && !typeaheadRef.current.text)) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      // Close only the list, not a dialog it sits in.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      // Hand focus back so Tab continues from the field.
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      typeahead(event.key);
    }
  };

  return (
    <div ref={rootRef} className={`select-button${isOpen ? ' is-open' : ''} ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={id}
        className="select-button__trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
          }
        }}
      >
        {!labelId && <span className="select-button__label">{label}</span>}
        {/* Every option sits in one grid cell, so the field keeps the width of
            the longest one and only the current one shows. */}
        <span id={valueId} className="select-button__value">
          {options.map(option => (
            <span
              key={option.value}
              className={option.value === value ? 'is-current' : undefined}
              aria-hidden={option.value === value ? undefined : 'true'}
            >
              {option.label}
            </span>
          ))}
        </span>
        <MaterialSymbol name="expand_more" className="select-button__chevron" />
      </button>
      {isOpen && position && createPortal(
        <ul
          ref={listRef}
          id={listId}
          className="select-button__list"
          role="listbox"
          tabIndex={-1}
          aria-label={labelId ? undefined : label}
          aria-labelledby={labelId}
          aria-activedescendant={`${listId}-${activeIndex}`}
          style={position}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              className={`select-button__option${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={option.value === value}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <MaterialSymbol name="check" className="select-button__check" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

export default SelectButton;
