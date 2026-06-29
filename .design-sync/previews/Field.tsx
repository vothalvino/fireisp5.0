import { Field } from '@fireisp/ui';

const noop = () => {};

export const Default = () => (
  <div style={{ width: 280 }}>
    <Field label="Client name" value="Acme Networks S.A." onChange={noop} placeholder="Full legal name" />
  </div>
);

export const WithHint = () => (
  <div style={{ width: 280 }}>
    <Field label="RFC" value="ACM010101AB9" onChange={noop} hint="12–13 character tax ID" required />
  </div>
);

export const WithError = () => (
  <div style={{ width: 280 }}>
    <Field label="Email" value="not-an-email" onChange={noop} error="Enter a valid email address" />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 280 }}>
    <Field label="Account #" value="FISP-000142" onChange={noop} disabled />
  </div>
);
