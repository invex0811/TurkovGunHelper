import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  getOrthogonalEdgePath,
  isDiagramEdgeHighlighted,
} from './weaponBuildDiagram.js';
import WeaponBuildDiagramStats from './WeaponBuildDiagramStats.jsx';

const MIN_SCALE = 0.28;
const MAX_SCALE = 1.5;

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function getNodeTooltip(node) {
  return [
    node.fullName,
    `Category: ${node.category}`,
    node.slotName ? `Slot: ${node.slotName}` : null,
    ...(node.stats || []),
    node.unresolved ? 'Parent slot could not be resolved' : null,
  ].filter(Boolean).join('\n');
}

function DiagramNode({ node, isSelected, onHighlight, onSelect }) {
  const fallbackLabel = (node.name || '?').slice(0, 2).toUpperCase();
  const interactive = node.nodeType !== 'weapon' && Boolean(node.slotInstanceId) && !node.unresolved;
  const className = `weapon-diagram-node weapon-diagram-node--${node.nodeType}${node.critical ? ' is-critical' : ''}${node.unresolved ? ' is-unresolved' : ''}${isSelected ? ' is-selected' : ''}`;
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
          <span>{node.nodeType === 'slot' ? '+' : fallbackLabel}</span>
        )}
      </div>
      <div className="weapon-diagram-node__body">
        <strong>{node.name}</strong>
        <span>{node.slotName && node.nodeType === 'module' ? `${node.category} · ${node.slotName}` : node.category}</span>
        {node.critical && <em>Required</em>}
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
    title: getNodeTooltip(node),
    'data-slot-instance-id': node.slotInstanceId || undefined,
    'aria-label': interactive
      ? `${node.nodeType === 'slot' ? 'Install a module in slot' : 'Replace module'} ${node.fullName}`
      : `${node.nodeType === 'weapon' ? 'Weapon' : 'Module'}: ${node.fullName}`,
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

function DiagramIcon({ type }) {
  if (type === 'fit') {
    return <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />;
  }
  if (type === 'center') {
    return (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    );
  }
  return null;
}

export default function WeaponBuildDiagram({ layout, selectedSlotId, stats, onSelectNode }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState(null);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map(node => [node.id, node])),
    [layout.nodes],
  );

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
      <div className="weapon-diagram__toolbar" aria-label="Diagram controls">
        <button className="btn btn--ghost" type="button" onClick={() => zoomAtCenter(1.15)} aria-label="Zoom in">+</button>
        <button className="btn btn--ghost" type="button" onClick={() => zoomAtCenter(0.85)} aria-label="Zoom out">−</button>
        <button className="btn btn--ghost weapon-diagram__text-control" type="button" onClick={fitToView}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><DiagramIcon type="fit" /></svg>
          Fit
        </button>
        <button className="btn btn--ghost weapon-diagram__text-control" type="button" onClick={centerView}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><DiagramIcon type="center" /></svg>
          Center
        </button>
        <span>{Math.round(view.scale * 100)}% · wheel to zoom, drag to pan</span>
      </div>

      <div
        ref={viewportRef}
        className={`weapon-diagram__viewport${isPanning ? ' is-panning' : ''}`}
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
                Number(isDiagramEdgeHighlighted(first, highlightedNodeId))
                - Number(isDiagramEdgeHighlighted(second, highlightedNodeId))
              ))
              .map(edge => {
              const sourceNode = nodeById.get(edge.source);
              const targetNode = nodeById.get(edge.target);
              const path = getOrthogonalEdgePath(sourceNode, targetNode);
              if (!path) return null;
              const isHighlighted = isDiagramEdgeHighlighted(edge, highlightedNodeId);
              return (
                <path
                  key={edge.id}
                  className={`${edge.unresolved ? 'is-unresolved' : ''}${edge.free ? ' is-free' : ''}${isHighlighted ? ' is-highlighted' : ''}`.trim()}
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
              onHighlight={setHighlightedNodeId}
              onSelect={onSelectNode}
            />
          ))}
        </div>
        <WeaponBuildDiagramStats stats={stats} />
      </div>
    </div>
  );
}
