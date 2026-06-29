import { Card, Button, Table, Badge } from '@fireisp/ui';

const noop = () => {};

export const WithHeader = () => (
  <div style={{ width: 360 }}>
    <Card title="Account balance" actions={<Button size="sm" onClick={noop}>Record Payment</Button>}>
      <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
        $1,648.00
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>2 open invoices</div>
    </Card>
  </div>
);

export const Plain = () => (
  <div style={{ width: 360 }}>
    <Card>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
        A surface for grouping related content — borders over shadows, the primary
        grouping primitive in FireISP's flat UI.
      </p>
    </Card>
  </div>
);

export const WrappingTable = () => (
  <div style={{ width: 420 }}>
    <Card title="Recent invoices" padding={false}>
      <Table
        columns={[
          { key: 'number', header: 'Invoice #' },
          { key: 'total', header: 'Total', align: 'right', numeric: true },
          { key: 'status', header: 'Status', align: 'right' },
        ]}
        rows={[
          { number: 'INV-000557', total: '$1,299.00', status: <Badge tone="success">Paid</Badge> },
          { number: 'INV-000558', total: '$349.00', status: <Badge tone="danger">Overdue</Badge> },
        ]}
      />
    </Card>
  </div>
);
