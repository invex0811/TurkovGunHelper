import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  findBuildSlotContext,
  getCompatibleItemsForSlot,
  planBuildSlotChange,
} from '../domain/weaponBuildEditor.js';
import WeaponBuildDiagram from './WeaponBuildDiagram.jsx';
import WeaponBuildSlotPanel from './WeaponBuildSlotPanel.jsx';
import {
  buildWeaponDiagramGraph,
  layoutWeaponDiagramGraph,
} from './weaponBuildDiagram.js';

export default function WeaponBuildDiagramModal({
  weapon,
  buildParts,
  allMods,
  stats,
  priceMode,
  includeTraderPrices,
  onBuildChange,
  onClose,
}) {
  const closeButtonRef = useRef(null);
  const selectedSlotRef = useRef(null);
  const lastTriggerRef = useRef(null);
  const [showFreeSlots, setShowFreeSlots] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [panelError, setPanelError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const graph = useMemo(
    () => buildWeaponDiagramGraph(weapon, buildParts, {
      includeFreeSlots: showFreeSlots,
      allMods,
      priceMode,
      includeTraderPrices,
    }),
    [allMods, buildParts, includeTraderPrices, priceMode, showFreeSlots, weapon],
  );
  const layout = useMemo(() => layoutWeaponDiagramGraph(graph), [graph]);
  const slotContext = useMemo(
    () => selectedSlotId
      ? findBuildSlotContext(weapon, buildParts, selectedSlotId).slotContext
      : null,
    [buildParts, selectedSlotId, weapon],
  );
  const compatibleItems = useMemo(
    () => slotContext ? getCompatibleItemsForSlot({
      weapon,
      buildParts,
      allMods,
      slotContext,
      priceMode,
      includeTraderPrices,
    }) : [],
    [allMods, buildParts, includeTraderPrices, priceMode, slotContext, weapon],
  );
  const moduleCount = graph.nodes.filter(node => node.nodeType === 'module').length;

  useEffect(() => {
    selectedSlotRef.current = selectedSlotId;
  }, [selectedSlotId]);

  const closePanel = useCallback(() => {
    const slotId = selectedSlotRef.current;
    setSelectedSlotId(null);
    setPendingPlan(null);
    setPanelError(null);
    setFeedback(null);
    window.requestAnimationFrame(() => {
      const currentNode = slotId
        ? document.querySelector(`[data-slot-instance-id="${slotId}"]`)
        : null;
      (currentNode || lastTriggerRef.current)?.focus?.();
    });
  }, []);

  useEffect(() => {
    const previousActiveElement = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = event => {
      if (event.key !== 'Escape') return;
      if (selectedSlotRef.current) {
        event.stopPropagation();
        closePanel();
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus?.();
    };
  }, [closePanel, onClose]);

  useEffect(() => {
    if (!import.meta.env.DEV || graph.diagnostics.length === 0) return;
    console.warn('Weapon build diagram diagnostics:', graph.diagnostics);
  }, [graph.diagnostics]);

  const handleSelectNode = useCallback((node, trigger) => {
    lastTriggerRef.current = trigger;
    setSelectedSlotId(node.slotInstanceId);
    setPendingPlan(null);
    setPanelError(null);
    setFeedback(null);
  }, []);

  const applyPlan = useCallback(plan => {
    const errors = onBuildChange?.(plan.buildParts) || [];
    if (errors.length > 0) {
      setPanelError(errors.join(' '));
      return;
    }
    setPendingPlan(null);
    setPanelError(null);
    setFeedback(plan.nextItem ? 'Module installed. Build stats and price updated.' : 'Module removed. Build stats and price updated.');
  }, [onBuildChange]);

  const requestChange = useCallback(nextItem => {
    const plan = planBuildSlotChange({
      weapon,
      buildParts,
      allMods,
      slotInstanceId: selectedSlotId,
      nextItem,
      priceMode,
      includeTraderPrices,
    });
    if (plan.errors?.length > 0) {
      setPanelError(plan.errors.join(' '));
      return;
    }
    setPanelError(null);
    setFeedback(null);
    if (plan.removedItems.length > 0) {
      setPendingPlan(plan);
      return;
    }
    applyPlan(plan);
  }, [allMods, applyPlan, buildParts, includeTraderPrices, priceMode, selectedSlotId, weapon]);

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
            <span>Current configuration</span>
            <h2 id="weaponDiagramTitle">Build Diagram</h2>
          </div>
          <div className="weapon-diagram-modal__summary">
            <strong>{weapon.shortName || weapon.name}</strong>
            <span>{moduleCount} {moduleCount === 1 ? 'module' : 'modules'}</span>
          </div>
          <label className="weapon-diagram-modal__free-toggle">
            <input
              type="checkbox"
              checked={showFreeSlots}
              onChange={event => setShowFreeSlots(event.target.checked)}
            />
            <span>Show empty slots</span>
          </label>
          <button
            ref={closeButtonRef}
            className="btn btn--ghost weapon-diagram-modal__close"
            type="button"
            onClick={onClose}
            aria-label="Close build diagram"
          >
            ×
          </button>
        </header>

        <div className={`weapon-diagram-modal__content${slotContext ? ' has-panel' : ''}`}>
          <WeaponBuildDiagram
            layout={layout}
            selectedSlotId={selectedSlotId}
            stats={stats}
            onSelectNode={handleSelectNode}
          />
          {slotContext && (
            <WeaponBuildSlotPanel
              key={selectedSlotId}
              weapon={weapon}
              slotContext={slotContext}
              compatibleItems={compatibleItems}
              isLoading={!allMods}
              error={panelError}
              feedback={feedback}
              pendingPlan={pendingPlan}
              priceMode={priceMode}
              includeTraderPrices={includeTraderPrices}
              onChoose={requestChange}
              onRemove={() => requestChange(null)}
              onConfirmPlan={() => applyPlan(pendingPlan)}
              onCancelPlan={() => setPendingPlan(null)}
              onClose={closePanel}
            />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
