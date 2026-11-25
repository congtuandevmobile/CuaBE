# Cua API

Clean Architecture backend for Cua mobile: Supabase Auth, profiles and activity history.

## Structure

```text
src/
├── app/                 # HTTP composition, routes, dependency container
├── config/              # Environment parsing
├── features/
│   ├── auth/            # Auth port, use service, Supabase adapter
│   ├── profile/         # Profile domain, application, repository
│   └── activity/        # Activity domain, application, repository
├── platform/supabase/   # Supabase client and row mappers
└── shared/              # Errors and HTTP concerns
supabase/migrations/     # Database schema, trigger and RLS policies
docs/openapi.yaml        # API contract
docs/activities.md       # Activities API + dedup rules
```

Dependency direction is `HTTP routes -> application services -> domain ports`; Supabase is only used by infrastructure adapters.

## Run

```bash
npm install # or: bun install
cp .env.example .env
npm run dev # or: bun run dev
```

Without `SUPABASE_URL` the API starts with `AUTH_DRIVER=memory`: users and tokens live in the process (demo/tests,
lost on restart; refused when `NODE_ENV=production`); activities then live in the process too. Fill `SUPABASE_URL` and
`SUPABASE_ANON_KEY` (or set `AUTH_DRIVER=supabase`) for real accounts. Profile routes always need Supabase.

```bash
curl -s localhost:4000/v1/auth/signup -H 'content-type: application/json' \
  -d '{"name":"Minh","email":"minh@example.com","username":"minh","password":"longenough"}'
```

Apply `supabase/migrations/0001_initial.sql`, `0002_username_profiles.sql`, `0003_user_code_email.sql`, `0004_activity_sync.sql` and `0005_heroes.sql` (in order) in the Supabase SQL editor or through
Supabase CLI.

Sign-up takes **name, email, username and password**; sign-in takes the **username or the email** + password. Every
user also gets a public 6-character `code` (e.g. `ABC314`, from migration 0003) next to the internal UUID. With
`AUTH_DRIVER=supabase` the API needs `SUPABASE_SERVICE_ROLE_KEY` (secret key): it looks usernames up (RLS hides other
users' rows from the publishable key) and creates users already confirmed, so "Confirm email" sends nothing.

## Routes

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | No |
| POST | `/v1/auth/signup` | No |
| POST | `/v1/auth/login` | No |
| POST | `/v1/auth/refresh` | No (refresh token in body) |
| GET | `/v1/auth/me` | Bearer |
| POST | `/v1/auth/logout` | Bearer |
| GET | `/v1/profile` | Bearer |
| PUT | `/v1/profile` | Bearer |
| PATCH | `/v1/profile` | Bearer |
| POST | `/v1/activities` | Bearer |
| POST | `/v1/activities/import` | Bearer |
| GET | `/v1/activities` | Bearer |
| GET | `/v1/activities/:id` | Bearer |
| GET | `/v1/hero` | Bearer |
| PUT | `/v1/hero` | Bearer |

Activities (phone recordings and Apple Health imports), their deduplication rules and error codes:
[docs/activities.md](docs/activities.md). The hero (3D character): [docs/hero.md](docs/hero.md).

Never commit `.env` or a Supabase service-role key. The mobile app should only receive the anon key and user session tokens.
