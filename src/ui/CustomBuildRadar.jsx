import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCustomBuildRadarValue,
  getCustomBuildRadarAxes,
  getRadarPoint,
  projectPointerToAxis,
  updateCustomBuildProfile,
  valueToRequirement,
} from './customBuildRadar.js';

const VIEW_BOX = Object.freeze({ width: 360, height: 288, centerX: 180, centerY: 142, radius: 82 });
const GRID_LEVELS = Object.freeze([0.2, 0.4, 0.6, 0.8, 1]);

function toPoints(points) {
  return points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

export default function CustomBuildRadar({ profile, weapon, onChange }) {
  const svgRef = useRef(null);
  const animationFrameRef = useRef(null);
  const pendingPointerRef = useRef(null);
  const activePointerRef = useRef(null);
  const [activeAxisKey, setActiveAxisKey] = useState(null);
  const axes = useMemo(() => getCustomBuildRadarAxes(weapon), [weapon]);
  const requirements = useMemo(
    () => Object.fromEntries(axes.map(axis => [axis.key, valueToRequirement(profile[axis.key], axis)])),
    [axes, profile],
  );

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const applyPointer = (axis, clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const pointerX = ((clientX - rect.left) / rect.width) * VIEW_BOX.width;
    const pointerY = ((clientY - rect.top) / rect.height) * VIEW_BOX.height;
    const requirement = projectPointerToAxis({
      pointerX,
      pointerY,
      centerX: VIEW_BOX.centerX,
      centerY: VIEW_BOX.centerY,
      axisX: axis.vector.x,
      axisY: axis.vector.y,
      radius: VIEW_BOX.radius,
    });
    onChange(updateCustomBuildProfile(profile, axis, requirement, weapon));
  };

  const queuePointer = (axis, event) => {
    pendingPointerRef.current = { axis, clientX: event.clientX, clientY: event.clientY };
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pending = pendingPointerRef.current;
      pendingPointerRef.current = null;
      if (pending) applyPointer(pending.axis, pending.clientX, pending.clientY);
    });
  };

  const handleKeyDown = (axis, event) => {
    const current = requirements[axis.key];
    const span = Math.max(axis.step, axis.range.max - axis.range.min);
    const delta = (axis.step / span) * (event.shiftKey ? 10 : 1);
    let next = null;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = current + delta;
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = current - delta;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = 1;
    if (next === null) return;

    event.preventDefault();
    onChange(updateCustomBuildProfile(profile, axis, next, weapon));
  };

  const beginPointerDrag = (axis, event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = { pointerId: event.pointerId, axisKey: axis.key };
    setActiveAxisKey(axis.key);
    queuePointer(axis, event);
  };

  const continuePointerDrag = (axis, event) => {
    if (
      activePointerRef.current?.pointerId !== event.pointerId
      || activePointerRef.current?.axisKey !== axis.key
    ) return;
    queuePointer(axis, event);
  };

  const endPointerDrag = (event) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerRef.current = null;
    setActiveAxisKey(null);
  };

  const cancelPointerDrag = () => {
    activePointerRef.current = null;
    setActiveAxisKey(null);
  };

  const gridPolygons = GRID_LEVELS.map(level => toPoints(
    axes.map(axis => getRadarPoint(
      VIEW_BOX.centerX,
      VIEW_BOX.centerY,
      VIEW_BOX.radius,
      axis.vector,
      level,
    )),
  ));
  const valuePoints = axes.map(axis => getRadarPoint(
    VIEW_BOX.centerX,
    VIEW_BOX.centerY,
    VIEW_BOX.radius,
    axis.vector,
    requirements[axis.key],
  ));

  return (
    <div className="custom-radar">
      <p className="custom-radar__help">Drag outward for a stricter requirement.</p>
      <svg
        ref={svgRef}
        className="custom-radar__svg"
        viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`}
        role="group"
        aria-label="Custom build requirements"
      >
        <g className="custom-radar__grid" aria-hidden="true">
          {gridPolygons.map((points, index) => <polygon key={GRID_LEVELS[index]} points={points} />)}
          {axes.map(axis => {
            const outerPoint = getRadarPoint(
              VIEW_BOX.centerX,
              VIEW_BOX.centerY,
              VIEW_BOX.radius,
              axis.vector,
              1,
            );
            return (
              <line
                key={axis.key}
                x1={VIEW_BOX.centerX}
                y1={VIEW_BOX.centerY}
                x2={outerPoint.x}
                y2={outerPoint.y}
              />
            );
          })}
        </g>

        <polygon className="custom-radar__value" points={toPoints(valuePoints)} aria-hidden="true" />

        <g className="custom-radar__axis-controls" aria-hidden="true">
          {axes.map(axis => {
            const outerPoint = getRadarPoint(
              VIEW_BOX.centerX,
              VIEW_BOX.centerY,
              VIEW_BOX.radius,
              axis.vector,
              1,
            );
            return (
              <line
                key={axis.key}
                data-axis-control={axis.key}
                x1={VIEW_BOX.centerX}
                y1={VIEW_BOX.centerY}
                x2={outerPoint.x}
                y2={outerPoint.y}
                onPointerDown={event => beginPointerDrag(axis, event)}
                onPointerMove={event => continuePointerDrag(axis, event)}
                onPointerUp={endPointerDrag}
                onPointerCancel={cancelPointerDrag}
              />
            );
          })}
        </g>

        {axes.map((axis, index) => {
          const point = valuePoints[index];
          const requirementPercent = Math.round(requirements[axis.key] * 100);
          const formattedValue = formatCustomBuildRadarValue(profile[axis.key], axis);
          return (
            <g
              key={axis.key}
              data-axis={axis.key}
              className={`custom-radar__handle ${activeAxisKey === axis.key ? 'is-active' : ''}`}
              role="slider"
              tabIndex="0"
              aria-label={axis.label}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={requirementPercent}
              aria-valuetext={formattedValue}
              aria-orientation="vertical"
              onKeyDown={event => handleKeyDown(axis, event)}
              onFocus={() => setActiveAxisKey(axis.key)}
              onBlur={() => setActiveAxisKey(null)}
              onPointerDown={event => beginPointerDrag(axis, event)}
              onPointerMove={event => continuePointerDrag(axis, event)}
              onPointerUp={endPointerDrag}
              onPointerCancel={cancelPointerDrag}
            >
              <circle className="custom-radar__hit-target" cx={point.x} cy={point.y} r="20" />
              <circle className="custom-radar__handle-dot" cx={point.x} cy={point.y} r="5" />
            </g>
          );
        })}

        {axes.map(axis => {
          const labelPoint = getRadarPoint(
            VIEW_BOX.centerX,
            VIEW_BOX.centerY,
            122,
            axis.vector,
            1,
          );
          const isRightLabel = axis.vector.x > 0.25;
          const isLeftLabel = axis.vector.x < -0.25;
          const labelX = isRightLabel ? VIEW_BOX.width - 8 : isLeftLabel ? 8 : labelPoint.x;
          const anchor = isRightLabel ? 'end' : isLeftLabel ? 'start' : 'middle';
          return (
            <text
              key={axis.key}
              className="custom-radar__label"
              x={labelX}
              y={labelPoint.y - 4}
              textAnchor={anchor}
              aria-hidden="true"
            >
              <tspan x={labelX}>{axis.label}</tspan>
              <tspan className="custom-radar__label-value" x={labelX} dy="14">
                {formatCustomBuildRadarValue(profile[axis.key], axis)}
              </tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}
