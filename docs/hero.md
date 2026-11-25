# Hero API

The user's 3D hero (body, skin tone, what it wears) is stored on the server, one per user. The app reads it after
sign-in / at start-up and sends the whole hero after every change. Both routes need `Authorization: Bearer <token>`.

## Hero

```json
{
  "name": "Cua",
  "gender": "female",
  "skinTone": 1,
  "equipment": { "top": "f-top-1", "bottom": "f-bottom-1", "shoes": "none", "sandals": "f-sandals-2", "watch": "garmin", "hat": "none", "hair": "f-hair-1" },
  "updatedAt": "2026-11-25T04:10:00.000Z"
}
```

| Field | Rule |
|---|---|
| `name` | trimmed, 1 … 40 chars |
| `gender` | `male` \| `female` |
| `skinTone` | integer 0 … 5 (index of the app's palette) |
| `equipment` | exactly the 7 slots `top bottom shoes sandals watch hat hair`; each an accessory id `^[a-z0-9][a-z0-9_-]{0,47}$`, `none` when empty |

Rules checked by the server: `top` and `bottom` are never `none`; `shoes` and `sandals` are never both worn. The
accessory catalog and the distance unlocks live in the app (`features/hero/domain/accessories.ts`): the server does not
know which ids exist, and the app falls back to the default item for an id it no longer knows.

## Routes

| Method | Path | Answer |
|---|---|---|
| GET | `/v1/hero` | `{ hero }`, or 404 `HERO_NOT_FOUND` when this account has none yet |
| PUT | `/v1/hero` | body = hero without `updatedAt`; creates or replaces it; `{ hero }` |

Writes are last-write-wins (the app sends one change at a time).

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | shape/field rules above |
| 400 | `HERO_INVALID` | an empty `top`/`bottom`, or shoes with sandals |
| 401 | `UNAUTHORIZED` | missing / invalid token |
| 404 | `HERO_NOT_FOUND` | no hero saved for this user |
| 500 | `HERO_READ_FAILED` / `HERO_SAVE_FAILED` | storage failure |

Storage: `supabase/migrations/0005_heroes.sql` (`public.heroes`, primary key `user_id`).
