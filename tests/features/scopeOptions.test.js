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

  assert.deepEqual(getScopeOptions({ fixedScope, reflex, ironSight, thermal }), [reflex, fixedScope]);
  assert.equal(isSelectableScope(ironSight), false);
});

test('scope options are sorted by zoom, then by the full name shown in the picker', () => {
  const named = (id, name, categories, zoomLevels) => ({ ...item(id, categories, { zoomLevels }), name });
  const pso = named('pso', 'BelOMO PSO-1 4x24 scope', ['Sights', 'Scope'], [[4, 4]]);
  const kmz = named('kmz', 'KMZ 1P59 3-10x riflescope', ['Sights', 'Scope'], [[3, 10]]);
  const specter = named('specter', 'ELCAN SpecterDR 1x/4x scope', ['Sights', 'Assault scope'], [[4, 1], [1]]);
  const eotech = named('eotech', 'EOTech 553 holographic sight', ['Sights', 'Reflex sight'], [[1]]);
  const acro = named('acro', 'Aimpoint ACRO P-1 reflex sight', ['Sights', 'Compact reflex sight'], [[1]]);
  const unknown = named('unknown', 'A sight without zoom data', ['Sights', 'Scope']);

  assert.deepEqual(
    getScopeOptions({ pso, kmz, specter, eotech, acro, unknown }),
    [acro, eotech, specter, kmz, pso, unknown],
  );
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
