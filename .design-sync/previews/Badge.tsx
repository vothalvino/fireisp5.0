import { Badge } from '@fireisp/ui';

export const Statuses = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Badge tone="success">Paid</Badge>
    <Badge tone="danger">Overdue</Badge>
    <Badge tone="warning">Pending</Badge>
    <Badge tone="accent">Active</Badge>
    <Badge tone="neutral">Draft</Badge>
  </div>
);
