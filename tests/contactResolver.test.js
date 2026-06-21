// =============================================================================
// FireISP 5.0 — GraphQL Contact resolver regression tests
// =============================================================================
// Guards a ClientDetail-breaking bug: the contacts table stores
// first_name/last_name (no `name` column), but GraphQL Contact.name is NON-NULL.
// With no resolver, `name` was undefined → the non-null violation bubbled up the
// chain (Contact.name! → [Contact!]! → Client.contacts!) and nulled the whole
// `client` query, so any client WITH contacts showed "Client not found".
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn(), execute: jest.fn(), getConnection: jest.fn() }));

const resolvers = require('../src/graphql/resolvers');

describe('GraphQL Contact field resolvers', () => {
  test('name is composed from first_name + last_name (no `name` column exists)', () => {
    expect(resolvers.Contact.name({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });

  test('name tolerates a missing first or last name without trailing/leading spaces', () => {
    expect(resolvers.Contact.name({ first_name: 'Ada', last_name: null })).toBe('Ada');
    expect(resolvers.Contact.name({ first_name: null, last_name: 'Lovelace' })).toBe('Lovelace');
  });

  test('name never returns null/undefined (the field is non-null GraphQL)', () => {
    // A row with neither name part must still yield a non-null string so it can
    // never blank ClientDetail again.
    expect(resolvers.Contact.name({})).toBe('(unnamed contact)');
    expect(resolvers.Contact.name({ first_name: '', last_name: '' })).toBe('(unnamed contact)');
    const v = resolvers.Contact.name({ first_name: null, last_name: null });
    expect(v).toBeTruthy();
    expect(typeof v).toBe('string');
  });
});
