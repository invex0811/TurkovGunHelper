import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n.js';
import { MaterialSymbol } from './MaterialSymbol.js';

import {
  getDiagramPathNodeIds,
  getDiagramSubtreeNodeIds,
  getOrthogonalEdgePath,
  isDiagramEdgeHighlighted,
} from './weaponBuildDiagram.js';
import WeaponBuildDiagramStats from './WeaponBuildDiagramStats.jsx';

const MIN_SCALE = 0.28;
const MAX_SCALE = 1.5;

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function getNodeLabels(node, t) {
  const fallbackName = node.nodeType === 'slot'
    ? t('ui.diagram.emptySlot')
    : t('ui.diagram.unknownModule');
  const name = node.name || fallbackName;
  const fullName = node.fullName || name;
  const category = node.category || (
    node.nodeType === 'slot'
      ? t('ui.diagram.emptySlot')
      : node.nodeType === 'weapon'
        ? t('ui.diagram.weaponCategory')
        : t('ui.diagram.moduleCategory')
  );
  return { name, fullName, category };
}

function formatNodeStat(stat, t) {
  if (typeof stat === 'string') return stat;
  if (!stat?.key) return '';
  return t(`ui.diagram.stat.${stat.key}`, { value: stat.value });
}

function formatNodePrice(price) {
  if (!Number.isFinite(price)) return null;
  if (price < 1000) return `${Math.round(price)} ₽`;
  if (price < 1000000) return `${Number.parseFloat((price / 1000).toFixed(price < 10000 ? 1 : 0))}k ₽`;
  return `${Number.parseFloat((price / 1000000).toFixed(1))}M ₽`;
}

function getNodeTooltip(node, labels, t) {
  return [
    labels.fullName,
    t('ui.diagram.category', { category: labels.category }),
    node.slotName ? t('ui.diagram.slot', { slot: node.slotName }) : null,
    ...(node.stats || []).map(stat => formatNodeStat(stat, t)),
    Number.isFinite(node.price)
      ? t('ui.diagram.price', { value: `${Math.round(node.price).toLocaleString('en-US')} ₽` })
      : null,
    node.unresolved ? t('ui.diagram.unresolvedParent') : null,
  ].filter(Boolean).join('\n');
}

// One compact line under the name: the ergonomics and recoil the module adds
// and what it costs, or how many modules fit an empty slot.
function DiagramNodeFacts({ node, t }) {
  // The weapon's own ergonomics is a base value, not a modifier.
  if (node.nodeType === 'weapon') return null;
  if (node.nodeType === 'slot') {
    if (!Number.isFinite(node.optionCount)) return null;
    return (
      <span className="weapon-diagram-node__facts">
        <span className="weapon-diagram-node__fact">{t('ui.diagram.options', { count: node.optionCount })}</span>
      </span>
    );
  }
  const stats = (node.stats || []).filter(stat => stat.key === 'ergonomics' || stat.key === 'recoil');
  const price = formatNodePrice(node.price);
  if (stats.length === 0 && !price) return null;
  return (
    <span className="weapon-diagram-node__facts">
      {stats.map(stat => (
        <span key={stat.key} className={`weapon-diagram-node__fact is-${stat.tone || 'neutral'}`}>
          {t(`ui.diagram.short.${stat.key}`, { value: stat.value })}
        </span>
      ))}
      {price && <span className="weapon-diagram-node__fact weapon-diagram-node__price">{price}</span>}
    </span>
  );
}

function DiagramNode({ node, isSelected, relation, onHighlight, onSelect, t }) {
  const labels = getNodeLabels(node, t);
  const fallbackLabel = labels.name.slice(0, 2).toUpperCase();
  const interactive = node.nodeType !== 'weapon' && Boolean(node.slotInstanceId) && !node.unresolved;
  const className = `weapon-diagram-node weapon-diagram-node--${node.nodeType}${node.critical ? ' is-critical' : ''}${node.unresolved ? ' is-unresolved' : ''}${isSelected ? ' is-selected' : ''}${relation ? ` is-${relation}` : ''}`;
  const content = (
    <>
      <div className="weapon-diagram-node__media" aria-hidden="true">
        {node.imageUrl ? (
          <img
            src={node.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={event => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : (
          node.nodeType === 'slot' ? <MaterialSymbol name="add" /> : <span>{fallbackLabel}</span>
        )}
      </div>
      <div className="weapon-diagram-node__body">
        <span className="weapon-diagram-node__title">
          <strong>{labels.name}</strong>
          {node.critical && <em>{t('ui.diagram.required')}</em>}
        </span>
        <span>{node.slotName && node.nodeType === 'module' ? `${labels.category} · ${node.slotName}` : labels.category}</span>
        <DiagramNodeFacts node={node} t={t} />
      </div>
    </>
  );

  const sharedProps = {
    className,
    style: {
      left: node.position.x,
      top: node.position.y,
      width: node.width,
      height: node.height,
    },
    title: getNodeTooltip(node, labels, t),
    'data-slot-instance-id': node.slotInstanceId || undefined,
    'aria-label': interactive
      ? node.nodeType === 'slot'
        ? t('ui.diagram.installInSlot', { name: labels.fullName })
        : t('ui.diagram.replaceModule', { name: labels.fullName })
      : node.nodeType === 'weapon'
        ? t('ui.diagram.weapon', { name: labels.fullName })
        : t('ui.diagram.module', { name: labels.fullName }),
    onPointerDown: event => event.stopPropagation(),
    onPointerEnter: () => onHighlight?.(node.id),
    onPointerLeave: () => onHighlight?.(null),
    onFocus: () => onHighlight?.(node.id),
    onBlur: () => onHighlight?.(null),
  };

  if (interactive) {
    return (
      <button
        {...sharedProps}
        type="button"
        aria-pressed={isSelected}
        onClick={event => onSelect?.(node, event.currentTarget)}
      >
        {content}
      </button>
    );
  }

  return (
    <article {...sharedProps}>{content}</article>
  );
}

export default function WeaponBuildDiagram({ layout, selectedSlotId, stats, onSelectNode }) {
  const { t } = useI18n();
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState(null);
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map(node => [node.id, node])),
    [layout.nodes],
  );
  const activeNodeId = nodeById.has(highlightedNodeId) ? highlightedNodeId : null;
  const pathNodeIds = useMemo(
    () => getDiagramPathNodeIds(layout.nodes, activeNodeId),
    [activeNodeId, layout.nodes],
  );
  const subtreeNodeIds = useMemo(
    () => getDiagramSubtreeNodeIds(layout.nodes, activeNodeId),
    [activeNodeId, layout.nodes],
  );
  // While a node is hovered, its chain to the weapon and everything mounted on
  // it stay lit and the rest of the build fades back.
  const getNodeRelation = node => {
    if (!activeNodeId || node.id === activeNodeId) return null;
    if (pathNodeIds.has(node.id)) return 'on-path';
    if (subtreeNodeIds.has(node.id)) return 'mounted';
    return 'dimmed';
  };

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const availableWidth = Math.max(1, bounds.width - 48);
    const availableHeight = Math.max(1, bounds.height - 48);
    const scale = clampScale(Math.min(
      availableWidth / Math.max(layout.width, 1),
      availableHeight / Math.max(layout.height, 1),
      1.1,
    ));
    setView({
      x: (bounds.width - layout.width * scale) / 2,
      y: (bounds.height - layout.height * scale) / 2,
      scale,
    });
  }, [layout.height, layout.width]);

  const centerView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    setView(current => ({
      ...current,
      x: (bounds.width - layout.width * current.scale) / 2,
      y: (bounds.height - layout.height * current.scale) / 2,
    }));
  }, [layout.height, layout.width]);

  const zoomAtCenter = useCallback(multiplier => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    setView(current => {
      const scale = clampScale(current.scale * multiplier);
      const ratio = scale / current.scale;
      return {
        scale,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      };
    });
  }, []);

  useLayoutEffect(() => {
    fitToView();
  }, [fitToView]);

  const handleWheel = event => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const multiplier = event.deltaY < 0 ? 1.1 : 0.9;
    setView(current => {
      const scale = clampScale(current.scale * multiplier);
      const ratio = scale / current.scale;
      return {
        scale,
        x: cursorX - (cursorX - current.x) * ratio,
        y: cursorY - (cursorY - current.y) * ratio,
      };
    });
  };

  const handlePointerDown = event => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    setIsPanning(true);
  };

  const handlePointerMove = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView(current => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };

  const stopDragging = event => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="weapon-diagram">
      <div className="weapon-diagram__toolbar" aria-label={t('ui.diagram.controls')}>
        <button className="btn btn--ghost" type="button" onClick={() => zoomAtCenter(1.15)} aria-label={t('ui.diagram.zoomIn')}><MaterialSymbol name="zoom_in" /></button>
        <button className="btn btn--ghost" type="button" onClick={() => zoomAtCenter(0.85)} aria-label={t('ui.diagram.zoomOut')}><MaterialSymbol name="zoom_out" /></button>
        <button className="btn btn--ghost weapon-diagram__text-control" type="button" onClick={fitToView}>
          <MaterialSymbol name="fit_screen" />
          {t('ui.diagram.fit')}
        </button>
        <button className="btn btn--ghost weapon-diagram__text-control" type="button" onClick={centerView}>
          <MaterialSymbol name="filter_center_focus" />
          {t('ui.diagram.center')}
        </button>
        <button
          className={`btn btn--ghost weapon-diagram__text-control weapon-diagram__stats-toggle${statsCollapsed ? ' is-collapsed' : ''}`}
          type="button"
          aria-pressed={!statsCollapsed}
          onClick={() => setStatsCollapsed(current => !current)}
        >
          <MaterialSymbol name="expand_more" />
          {t('ui.diagram.statsToggle')}
        </button>
        <span>{t('ui.diagram.panZoomHint', { scale: Math.round(view.scale * 100) })}</span>
      </div>

      <div
        ref={viewportRef}
        className={`weapon-diagram__viewport${isPanning ? ' is-panning' : ''}${activeNodeId ? ' has-highlight' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div
          className="weapon-diagram__canvas"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <svg
            className="weapon-diagram__edges"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            {[...layout.edges]
              .sort((first, second) => (
                Number(isDiagramEdgeHighlighted(first, pathNodeIds))
                - Number(isDiagramEdgeHighlighted(second, pathNodeIds))
              ))
              .map(edge => {
              const sourceNode = nodeById.get(edge.source);
              const targetNode = nodeById.get(edge.target);
              const path = getOrthogonalEdgePath(sourceNode, targetNode, edge);
              if (!path) return null;
              const isHighlighted = isDiagramEdgeHighlighted(edge, pathNodeIds);
              const isMounted = !isHighlighted && isDiagramEdgeHighlighted(edge, subtreeNodeIds);
              return (
                <path
                  key={edge.id}
                  className={`${edge.unresolved ? 'is-unresolved' : ''}${edge.free ? ' is-free' : ''}${isHighlighted ? ' is-highlighted' : ''}${isMounted ? ' is-mounted' : ''}`.trim()}
                  d={path}
                />
              );
            })}
          </svg>
          {layout.nodes.map(node => (
            <DiagramNode
              key={node.id}
              node={node}
              isSelected={node.slotInstanceId === selectedSlotId}
              relation={getNodeRelation(node)}
              onHighlight={setHighlightedNodeId}
              onSelect={onSelectNode}
              t={t}
            />
          ))}
        </div>
        {!statsCollapsed && <WeaponBuildDiagramStats stats={stats} />}
      </div>
    </div>
  );
}
