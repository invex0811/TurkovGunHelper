import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import WeaponBuildDiagram from './WeaponBuildDiagram.jsx';
import {
  buildWeaponDiagramGraph,
  layoutWeaponDiagramGraph,
} from './weaponBuildDiagram.js';

export default function WeaponBuildDiagramModal({ weapon, buildParts, onClose }) {
  const closeButtonRef = useRef(null);
  const graph = useMemo(
    () => buildWeaponDiagramGraph(weapon, buildParts),
    [buildParts, weapon],
  );
  const layout = useMemo(() => layoutWeaponDiagramGraph(graph), [graph]);

  useEffect(() => {
    const previousActiveElement = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (!import.meta.env.DEV || graph.diagnostics.length === 0) return;
    console.warn('Weapon build diagram diagnostics:', graph.diagnostics);
  }, [graph.diagnostics]);

  return createPortal(
    <div className="weapon-diagram-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="weapon-diagram-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weaponDiagramTitle"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="weapon-diagram-modal__head">
          <div>
            <span>Текущая конфигурация</span>
            <h2 id="weaponDiagramTitle">Схема сборки</h2>
          </div>
          <div className="weapon-diagram-modal__summary">
            <strong>{weapon.shortName || weapon.name}</strong>
            <span>{Math.max(0, graph.nodes.length - 1)} модулей</span>
          </div>
          <button
            ref={closeButtonRef}
            className="btn btn--ghost weapon-diagram-modal__close"
            type="button"
            onClick={onClose}
            aria-label="Закрыть схему сборки"
          >
            ×
          </button>
        </header>

        <WeaponBuildDiagram layout={layout} />
      </section>
    </div>,
    document.body,
  );
}
