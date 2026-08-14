import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getScopeOptions,
  getScopeZoomLevels,
  getScopeZoomOptions,
  isSelectableScope,
  scopeSupportsZoom,
} from '../../src/features/configurator/scopeOptions.js';

function item(id, categories, properties = {}) {
  return { id, shortName: id, categories: categories.map(name => ({ name })), properties };
}

test('scope options use catalog categories and exclude unsupported sight types', () => {
  const fixedScope = item('fixed', ['Sights', 'Scope'], { zoomLevels: [4] });
  const reflex = item('reflex', ['Sights', 'Reflex sight']);
  const ironSight = item('iron', ['Sights', 'Ironsight']);
  const thermal = item('thermal', ['Sights', 'Thermal Vision']);

  assert.deepEqual(getScopeOptions({ fixedScope, reflex, ironSight, thermal }), [fixedScope, reflex]);
  assert.equal(isSelectableScope(ironSight), false);
});

test('zoom filters use only structured zoom levels with a 1x reflex fallback', () => {
  const fixedScope = item('fixed', ['Sights', 'Scope'], { zoomLevels: [[4]] });
  const variableScope = item('variable', ['Sights', 'Scope'], { zoomLevels: [[1, 4], [6]] });
  const reflex = item('reflex', ['Sights', 'Reflex sight']);

  assert.deepEqual(getScopeZoomLevels(variableScope), [1, 4, 6]);
  assert.deepEqual(getScopeZoomOptions([fixedScope, variableScope, reflex]), [1, 4, 6]);
  assert.equal(scopeSupportsZoom(variableScope, 4), true);
  assert.equal(scopeSupportsZoom(variableScope, 5), false);
  assert.equal(scopeSupportsZoom(reflex, 1), true);
});
