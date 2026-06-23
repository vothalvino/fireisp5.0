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

    """Fetch a single contract by ID (org-scoped)."""
    contract(id: ID!): Contract

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
    locale: String
    notes: String
    createdAt: String!

    """Current account balance — signed sum of the balance ledger. Postpaid
    semantics: positive = the client owes; negative = the client has credit."""
    balance: String!

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

    """The client who owns this contract."""
    client: Client

    """Invoices issued against this contract."""
    invoices: [Invoice!]!

    """Devices assigned to this contract."""
    devices: [Device!]!

    """Add-ons attached to this contract."""
    addons: [ContractAddon!]!
  }

  type ContractAddon {
    id: ID!
    contractId: ID!
    planAddonId: ID!
    addonName: String
    addonType: String
    quantity: String
    unitPrice: String
    startDate: String
    endDate: String
    status: String!
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

  type Subscription {
    """New comment posted on a specific ticket."""
    ticketCommentAdded(ticketId: ID!): TicketComment!

    """Device status updated within an organisation."""
    deviceStatusChanged(orgId: ID!): Device!
  }

  # ===========================================================================
  # AI Reply Assistant — types, queries, and mutation (§5.2)
  # ===========================================================================

  """AI Reply Assistant policy for an organisation."""
  type AiPolicy {
    organizationId: ID!
    enabled: Boolean!
    enabledChannels: AiChannels!
    mode: String!
    autoSendConfidence: String!
    defaultLocale: String!
    tone: String!
    redactPiiBeforeLlm: Boolean!
    activeProviderId: ID
  }

  """Per-channel on/off switches."""
  type AiChannels {
    portal: Boolean!
    email: Boolean!
    whatsapp: Boolean!
    sms: Boolean!
  }

  """Registered LLM provider (api key is never exposed)."""
  type AiProvider {
    id: ID!
    organizationId: ID!
    name: String!
    kind: String!
    model: String!
    endpointUrl: String
    temperature: String
    maxTokens: Int
    timeoutMs: Int
    enabled: Boolean!
    priority: Int!
    createdAt: String!
    updatedAt: String!
  }

  """Curated phrase from the phrase library."""
  type AiPhrase {
    id: ID!
    organizationId: ID!
    locale: String!
    category: String!
    text: String!
    isRequired: Boolean!
    createdAt: String
    updatedAt: String
  }

  """Audit log entry for an AI draft/send action."""
  type AiReplyLog {
    id: ID!
    ticketId: ID!
    providerId: ID
    classification: String
    confidence: String
    draftText: String
    finalText: String
    action: String
    reviewerUserId: ID
    promptTokens: Int
    completionTokens: Int
    costUsd: String
    durationMs: Int
    error: String
    createdAt: String!
  }

  """Result of the aiDraftReply mutation."""
  type AiDraftReplyResult {
    skipped: Boolean!
    reason: String
    logId: ID
    draftText: String
    action: String
  }

  extend type Query {
    """Fetch the AI policy for the current org."""
    aiPolicy: AiPolicy

    """List all enabled AI providers for the current org (no keys)."""
    aiProviders: [AiProvider!]!

    """List phrases in the phrase library (optionally filtered)."""
    aiPhrases(locale: String, category: String, limit: Int, offset: Int): [AiPhrase!]!

    """Paginated AI reply log for a specific ticket."""
    aiReplyLogs(ticketId: ID!, limit: Int, offset: Int): [AiReplyLog!]!
  }

  type Mutation {
    """
    Force-generate a draft reply for a ticket.
    Equivalent to POST /api/v1/ai/reply/draft — always returns the draft
    text rather than auto-sending, regardless of the policy mode.
    """
    aiDraftReply(
      ticketId: ID!
      inboundText: String!
      channel: String
      contractId: ID
    ): AiDraftReplyResult!
  }
`;
