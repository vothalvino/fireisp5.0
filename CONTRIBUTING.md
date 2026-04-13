# Contributing to FireISP 5.0

Thank you for your interest in contributing to FireISP! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **MySQL** 8.0+ or MariaDB 10.6+ (with `event_scheduler=ON`)
- **Git**

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/fireisp5.0.git
cd fireisp5.0

# Install dependencies
npm ci

# Copy environment config
cp .env.example .env
# Edit .env with your database credentials

# Run database migrations
npm run migrate

# Seed test data (optional)
npm run seed

# Start development server (auto-reload)
npm run dev

# Run tests
npm test

# Run linter
npm run lint
```

### Project Structure

```
fireisp5.0/
├── database/           # SQL schema and migrations
│   ├── schema.sql      # Full schema (for fresh installs)
│   └── migrations/     # Numbered migration files (136+)
├── docs/               # Deployment, RADIUS, API, and Grafana docs
├── public/             # Admin dashboard (vanilla HTML/CSS/JS)
│   ├── index.html      # SPA entry point
│   ├── css/            # Stylesheets
│   └── js/             # Client-side JavaScript
├── src/
│   ├── app.js          # Express application setup
│   ├── server.js       # HTTP server entry point
│   ├── config/         # App config, database pool, FireRelay
│   ├── controllers/    # Route handler logic
│   ├── middleware/      # Auth, RBAC, rate limiting, validation, schemas
│   ├── models/         # Database models (BaseModel + 50+ entities)
│   ├── routes/         # Express routers (68 route files)
│   ├── services/       # Business logic (billing, CFDI, RADIUS, alerts…)
│   ├── scripts/        # CLI tools (migrate, seed, backup, admin)
│   ├── utils/          # Logger, i18n, errors, OpenAPI generator
│   ├── views/          # Email templates
│   └── locales/        # i18n translation files (en, es)
├── storage/            # File uploads and backups
└── tests/              # Jest tests (51+ files, 930+ tests)
```

### API Architecture

- **Auth**: JWT with refresh token rotation, TOTP 2FA
- **Multi-org**: All data scoped by `organization_id` via `X-Org-Id` header
- **RBAC**: Permission-based access control per route
- **Versioning**: Routes available at both `/api/` and `/api/v1/`
- **Real-time**: SSE event streams at `/api/events/`
- **Metrics**: Prometheus at `/metrics`, Grafana templates in `docs/grafana/`

### Running Tests

```bash
# All tests (unit + integration)
npm test

# Watch mode
npm run test:watch

# Database integration tests (requires Docker)
npm run test:db

# Run a specific test file
npx jest tests/billingService.test.js --forceExit
```

### Code Style

- **ESLint** is configured — run `npm run lint` before committing
- No trailing semicolons? Wrong — this project **uses semicolons**
- Single quotes for strings
- 2-space indentation
- Trailing commas in multiline expressions

### Making Changes

1. **Create a branch** from `main`: `git checkout -b feat/my-feature`
2. **Write tests first** — all new code needs test coverage
3. **Run the full suite** before pushing: `npm run lint && npm test`
4. **Keep PRs focused** — one feature or fix per PR
5. **Update docs** if your change affects the API or configuration

### Database Migrations

Migrations are numbered SQL files in `database/migrations/`:

```bash
# Create a new migration
touch database/migrations/137_description.sql

# Apply migrations
npm run migrate
```

Rules:
- Always add `IF NOT EXISTS` / `IF EXISTS` guards
- Include both the forward migration in the file
- Test with `docker compose -f docker-compose.test.yml up --build`

### Commit Messages

Follow conventional commits:

```
feat: add bulk client import endpoint
fix: correct tax calculation for zero-rated items
docs: add RADIUS troubleshooting section
test: add E2E billing workflow tests
chore: update dependencies
```

## Reporting Issues

- Check existing issues first
- Include steps to reproduce
- Include relevant log output (sanitized — no secrets!)
- Specify your Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
