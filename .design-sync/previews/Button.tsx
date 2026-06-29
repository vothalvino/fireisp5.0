import { Button } from '@fireisp/ui';

const noop = () => {};

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button variant="primary" onClick={noop}>Record Payment</Button>
    <Button variant="secondary" onClick={noop}>Edit</Button>
    <Button variant="ghost" onClick={noop}>Cancel</Button>
    <Button variant="danger" onClick={noop}>Void invoice</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Button size="sm" onClick={noop}>Small</Button>
    <Button size="md" onClick={noop}>Medium</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Button disabled>Primary</Button>
    <Button variant="secondary" disabled>Secondary</Button>
  </div>
);
