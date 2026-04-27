// =============================================================================
// FireISP 5.0 — GraphQL Type Definitions (P3.3)
// =============================================================================
// SDL schema covering the core resources used by operator detail pages.
// Resolving nested fields (contracts, invoices, etc.) in a single round-trip
// eliminates the over-fetching that occurs with 4–6 sequential REST calls per
// detail page.
// =============================================================================

module.exports = /* GraphQL */ `
  type Query {
    """Fetch a single client by ID (org-scoped)."""
    client(id: ID!): Client

    """List clients for the current org."""
    clients(limit: Int, offset: Int): [Client!]!

    """Fetch a single invoice by ID (org-scoped)."""
    invoice(id: ID!): Invoice

    """List invoices, optionally filtered by clientId."""
    invoices(limit: Int, offset: Int, clientId: ID): [Invoice!]!

    """Fetch a single ticket by ID (org-scoped)."""
    ticket(id: ID!): Ticket

    """List tickets, optionally filtered by clientId."""
    tickets(limit: Int, offset: Int, clientId: ID): [Ticket!]!
  }

  type Client {
    id: ID!
    name: String!
    email: String
    phone: String
    clientType: String!
    status: String!
    address: String
    city: String
    state: String
    zipCode: String
    country: String
    taxId: String
    notes: String
    createdAt: String!

    """Active contracts for this client."""
    contracts: [Contract!]!

    """Invoices issued to this client."""
    invoices: [Invoice!]!

    """Payments made by this client (most recent first, max 100)."""
    payments: [Payment!]!

    """Devices assigned to this client's contracts."""
    devices: [Device!]!

    """Balance ledger entries (most recent first)."""
    ledger: [LedgerEntry!]!

    """Contact persons for this client."""
    contacts: [Contact!]!
  }

  type Contract {
    id: ID!
    clientId: ID!
    planId: ID
    connectionType: String
    startDate: String
    endDate: String
    billingDay: Int
    status: String!
    ipAddress: String
    priceOverride: String
    notes: String
    createdAt: String!
  }

  type Invoice {
    id: ID!
    clientId: ID!
    contractId: ID
    invoiceNumber: String!
    subtotal: String!
    taxAmount: String!
    total: String!
    currency: String!
    dueDate: String
    paidAt: String
    status: String!
    notes: String
    createdAt: String!

    """The client who owns this invoice."""
    client: Client

    """Line items on this invoice."""
    items: [InvoiceItem!]!

    """Payments applied against this invoice."""
    appliedPayments: [AppliedPayment!]!
  }

  type InvoiceItem {
    id: ID!
    description: String!
    quantity: String!
    unitPrice: String!
    amount: String!
    taxRate: String
  }

  type AppliedPayment {
    id: ID!
    paymentId: ID!
    invoiceId: ID!
    amount: String!
    paymentAmount: String
    paymentMethod: String
    paymentDate: String
  }

  type Payment {
    id: ID!
    amount: String!
    currency: String!
    paymentMethod: String!
    reference: String
    status: String!
    createdAt: String!
  }

  type Device {
    id: ID!
    name: String!
    type: String
    manufacturer: String
    model: String
    macAddress: String
    ipAddress: String
    status: String!
    contractId: ID
  }

  type LedgerEntry {
    id: ID!
    entryType: String!
    amount: String!
    currency: String!
    referenceType: String
    referenceId: ID
    balanceAfter: String!
    notes: String
    createdAt: String!
  }

  type Contact {
    id: ID!
    name: String!
    email: String
    phone: String
    role: String
  }

  type Ticket {
    id: ID!
    clientId: ID
    contractId: ID
    assignedTo: ID
    subject: String!
    description: String
    priority: String!
    category: String
    status: String!
    createdAt: String!
    updatedAt: String!

    """The client this ticket belongs to."""
    client: Client

    """Comments on this ticket (chronological)."""
    comments: [TicketComment!]!
  }

  type TicketComment {
    id: ID!
    ticketId: ID!
    userId: ID
    body: String!
    isInternal: Boolean!
    createdAt: String!
  }
`;
