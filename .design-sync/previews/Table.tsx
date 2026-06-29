import { Table, Badge } from '@fireisp/ui';

const columns = [
  { key: 'number', header: 'Invoice #' },
  { key: 'total', header: 'Total', align: 'right', numeric: true },
  { key: 'due', header: 'Due', align: 'right' },
  { key: 'status', header: 'Status', align: 'right' },
];

export const Invoices = () => (
  <Table
    columns={columns}
    rows={[
      { number: 'INV-000557', total: '$1,299.00', due: '2026-07-01', status: <Badge tone="success">Paid</Badge> },
      { number: 'INV-000558', total: '$349.00', due: '2026-07-05', status: <Badge tone="danger">Overdue</Badge> },
      { number: 'INV-000559', total: '$899.00', due: '2026-07-12', status: <Badge tone="warning">Pending</Badge> },
    ]}
  />
);

export const Empty = () => (
  <Table columns={columns} rows={[]} empty="No invoices for this client" />
);
