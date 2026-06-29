import { Modal, Button } from '@fireisp/ui';

const noop = () => {};

export const Default = () => (
  <div style={{ width: 560 }}>
    <Modal
      open
      inline
      title="Void invoice INV-000557"
      onClose={noop}
      footer={
        <>
          <Button variant="ghost" onClick={noop}>Cancel</Button>
          <Button variant="danger" onClick={noop}>Void</Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
        Voiding this invoice marks it as $0 on the client ledger and removes it from the
        balance. This cannot be undone.
      </p>
    </Modal>
  </div>
);
