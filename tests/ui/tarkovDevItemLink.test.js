import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTarkovDevItemUrl,
  TarkovDevItemLink,
} from '../../src/ui/TarkovDevItemLink.js';

const m4a1 = {
  id: '5447a9cd4bdc2dbd208b4567',
  name: 'Colt M4A1 5.56x45 assault rifle',
  normalizedName: 'colt-m4a1-556x45-assault-rifle',
  link: 'https://tarkov.dev/item/colt-m4a1-556x45-assault-rifle',
};

test('renders a tarkov.dev link for a weapon with an official item URL', () => {
  const element = TarkovDevItemLink({ weapon: m4a1 });

  assert.equal(element.type, 'a');
  assert.equal(element.props.href, m4a1.link);
  assert.equal(element.props.target, '_blank');
  assert.equal(element.props.rel, 'noopener noreferrer');
  assert.equal(element.props.title, 'Открыть оружие на tarkov.dev');
});

test('updates the item URL when the selected weapon changes', () => {
  const firstLink = TarkovDevItemLink({ weapon: m4a1 });
  const secondLink = TarkovDevItemLink({
    weapon: {
      name: 'Kalashnikov AK-74M 5.45x39 assault rifle',
      normalizedName: 'kalashnikov-ak-74m-545x39-assault-rifle',
    },
  });

  assert.equal(firstLink.props.href, 'https://tarkov.dev/item/colt-m4a1-556x45-assault-rifle');
  assert.equal(secondLink.props.href, 'https://tarkov.dev/item/kalashnikov-ak-74m-545x39-assault-rifle');
});

test('uses the official normalized name without deriving a slug from the weapon name', () => {
  assert.equal(
    getTarkovDevItemUrl({ normalizedName: 'official-api-slug', name: 'Different Name' }),
    'https://tarkov.dev/item/official-api-slug',
  );
  assert.equal(getTarkovDevItemUrl({ name: 'Colt M4A1 5.56x45 assault rifle' }), null);
});

test('falls through an invalid optional URL to the official API link', () => {
  assert.equal(
    getTarkovDevItemUrl({
      tarkovDevUrl: 'https://example.com/item/wrong-host',
      link: m4a1.link,
    }),
    m4a1.link,
  );
});

test('renders non-clickable text when the weapon has no valid tarkov.dev URL', () => {
  for (const weapon of [
    null,
    {},
    { link: 'https://example.com/item/not-tarkov-dev' },
    { link: 'javascript:alert(1)' },
    { normalizedName: '../invalid-slug' },
  ]) {
    const element = TarkovDevItemLink({ weapon });

    assert.equal(element.type, 'span');
    assert.equal(element.props.href, undefined);
  }
});

test('link interaction has no configurator state handler', () => {
  const element = TarkovDevItemLink({ weapon: m4a1 });

  assert.equal(element.props.onClick, undefined);
});
