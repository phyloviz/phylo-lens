import { expect, it } from 'vitest';
import { renderAncillaryWheel } from '../src/components/ancillary-wheel/AncillaryWheel';
import { freezeInput } from './helpers/state';

it('renders prepared frequencies as text without interpreting category labels as HTML', () => {
  const container = document.createElement('div');
  const distribution = freezeInput({
    observationCount: 2,
    nodeCount: 1,
    categories: [{ key: 'a', category: '<b>PT</b>', label: '<b>PT</b>', count: 2, percentage: 100, color: '#123456' }],
  });
  renderAncillaryWheel(container, distribution, 'No data');
  expect(container.textContent).toContain('<b>PT</b>');
  expect(container.textContent).toContain('100.0%');
  expect(container.querySelector('b')).toBeNull();
  renderAncillaryWheel(container, null, '<b>No data</b>');
  expect(container.textContent).toBe('<b>No data</b>');
  expect(container.querySelector('b')).toBeNull();
});
