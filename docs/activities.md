# Activities API

Activities are stored per user on the server. They come from two sources:

| `source` | Written by | `externalId` is |
|---|---|---|
| `phone` | `POST /v1/activities` (a recording made with the Cua app) | the **client-generated id** (idempotency key) |
| `apple_health` | `POST /v1/activities/import` (HealthKit workouts) | the **HealthKit workout UUID** (may be `null`) |

Every route needs `Authorization: Bearer <accessToken>` (the session from `/v1/auth/*`). A user only ever sees and
writes their own rows: the user id comes from the verified token, never from the body.

## Activity

```json
{
  "id": "0b8e…-uuid",
  "userId": "…",
  "source": "apple_health",
  "externalId": "5A3C…-HK-UUID",
  "activityType": "running",
  "startedAt": "2026-11-19T23:00:00.000Z",
  "endedAt": "2026-11-19T23:35:00.000Z",
  "durationSec": 1980,
  "distanceMeters": 5230.5,
  "energyKcal": 310,
  "sourceName": "Apple Watch",
  "metadata": {},
  "createdAt": "2026-11-25T03:12:44.120Z"
}
```

Input fields (both write routes):

| Field | Type | Rule |
|---|---|---|
| `activityType` | string | lower camel case HealthKit name, `^[a-zA-Z][a-zA-Z0-9_]{0,63}$` |
| `startedAt`, `endedAt` | ISO 8601 with zone | `endedAt >= startedAt`; stored and returned in UTC |
| `durationSec` | number | moving time, 0 … 604800 |
| `distanceMeters` | number \| null | 0 … 1 000 000, default `null` |
| `energyKcal` | number \| null | 0 … 100 000, default `null` |
| `sourceName` | string \| null | ≤ 120 chars, default `null` |
| `metadata` | flat object | ≤ 20 keys, values string(≤500)/number/boolean/null. **No route, coordinates or samples.** |

## Routes

### `POST /v1/activities` — save a phone recording

Body: the fields above + `clientId` (`^[A-Za-z0-9._:-]{8,128}$`), generated on the device **once** and reused on
every retry of the same recording.

| Status | Body | When |
|---|---|---|
| 201 | `{ activity, created: true }` | stored now |
| 200 | `{ activity, created: false }` | this `clientId` was already stored: the stored activity is returned, the body is **not** compared or applied |

### `POST /v1/activities/import` — import workouts in a batch

```json
{ "source": "apple_health", "items": [ { "externalId": "HK-UUID", "activityType": "cycling", "startedAt": "…", "endedAt": "…", "durationSec": 3600 } ] }
```

At most **200 items** per call (send larger syncs in chunks). Always 200:

```json
{
  "created": 1,
  "skipped": 2,
  "results": [
    { "index": 0, "externalId": "HK-1", "status": "created", "activityId": "…" },
    { "index": 1, "externalId": "HK-1", "status": "skipped", "activityId": "…", "reason": "in_batch" },
    { "index": 2, "externalId": "HK-7", "status": "skipped", "activityId": "…", "reason": "time_window" }
  ]
}
```

`results[i].activityId` is the stored activity the item created or duplicates, so the client can map every item.

### `GET /v1/activities?limit=20&cursor=…&source=…` — list, newest first

- Order: `startedAt` desc, then `id` desc (stable for equal start times).
- `limit` 1 … 100 (default 20). `source` optional (`phone` \| `apple_health`).
- Response: `{ activities: Activity[], nextCursor: string | null }`. Pass `nextCursor` back unchanged as `cursor`;
  `null` means the last page. The cursor is opaque (keyset on `startedAt|id`), so rows inserted while paging never
  shift or repeat pages.

### `GET /v1/activities/:id`

`{ activity }`, or 404 `ACTIVITY_NOT_FOUND` when it does not exist **or belongs to another user**.

## Deduplication rules

Applied in this order; the first match wins.

1. **Idempotency key** — `(userId, source, externalId)` is a unique index
   (`activities_user_source_external_key`). Writes use `insert … on conflict do nothing`, so a retry or a concurrent
   request can never create a second row (reason `external_id`).
2. **Time window** (import only, fallback for a missing or changed UUID) — an existing activity of the **same user,
   same source, same `activityType`** whose `startedAt` **and** `endedAt` are both within **60 s** of the item
   (reason `time_window`).
3. **Inside the batch** — repeated UUIDs or time-window matches inside one request: the first occurrence is stored,
   the others point at it (reason `in_batch`).

Deliberate limits:

- Dedup is **per source**: a phone recording and an Apple Watch workout of the same run are both kept (they are
  different measurements; merging sources is a product decision, not a storage rule).
- Duplicates are skipped, never updated: a re-import does not overwrite edited or newer data.
- Rule 2 is serialized per user inside one API process. Across several API instances, two simultaneous imports of the
  same **UUID-less** workout could both pass rule 2; workouts with a UUID are always protected by the unique index.

### Reinstall scenario

The user deletes the app, reinstalls, signs in and connects Apple Health again. The app has no local sync state, so
it reads the whole window (90 days) and sends it in chunks of ≤ 200. Every workout already on the server is answered
`skipped` with its existing `activityId`; only genuinely new ones are `created`.

## Errors

Every error is `{ "error": { "code": "…", "message": "…" } }`.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body or query fails the rules above (incl. > 200 items, unknown `source`) |
| 400 | `ACTIVITY_CURSOR_INVALID` | `cursor` was not issued by this API |
| 400 | `BAD_REQUEST` | malformed JSON / empty body with a JSON content type |
| 401 | `UNAUTHORIZED` | missing, invalid or expired bearer token |
| 404 | `ACTIVITY_NOT_FOUND` | unknown id or another user's activity |
| 500 | `ACTIVITY_CREATE_FAILED` / `ACTIVITY_LIST_FAILED` / `ACTIVITY_IMPORT_FAILED` | storage failure (details only in the server log) |
| 503 | `SUPABASE_NOT_CONFIGURED` | Supabase driver without URL / service-role key |

## Storage

`supabase/migrations/0004_activity_sync.sql` adds `source`, `external_id`, `duration_sec`, `distance_m`,
`energy_kcal`, `source_name`, makes `ended_at` required, and creates the unique key plus the
`(user_id, started_at desc, id desc)` and `(user_id, source, started_at)` indexes. With `AUTH_DRIVER=memory` the same
rules run on an in-process store (development and tests).
