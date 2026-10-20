import test from 'node:test';
import assert from 'node:assert/strict';
import { withLastModified } from '../../scripts/lib/weaponCatalog.mjs';

const m4 = { id: 'a', normalizedName: 'm4a1', name: 'Colt M4A1', shortName: 'M4A1', caliber: '5.56x45 NATO', type: 'Assault rifle' };
const glock = { id: 'b', normalizedName: 'glock-17', name: 'Glock 17', shortName: 'Glock 17', caliber: '9x19 Parabellum', type: 'Handgun' };

test('an unchanged weapon keeps its date; a changed or new one gets today', () => {
  const previous = [
    { ...m4, lastModified: '2026-09-01' },
    { ...glock, lastModified: '2026-09-01' },
  ];
  const renamed = { ...glock, name: 'Glock 17 9x19 pistol' };
  const added = { ...glock, id: 'c', normalizedName: 'glock-19x' };
  assert.deepEqual(
    withLastModified([m4, renamed, added], previous, '2026-10-20').map(weapon => weapon.lastModified),
    ['2026-09-01', '2026-10-20', '2026-10-20'],
  );
});

test('the comparison ignores the order of fields', () => {
  const reordered = Object.fromEntries(Object.entries(m4).reverse());
  const [weapon] = withLastModified([reordered], [{ ...m4, lastModified: '2026-09-01' }], '2026-10-20');
  assert.equal(weapon.lastModified, '2026-09-01');
});
