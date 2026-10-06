# Job progress logs (work note + customer-safe update)

The assigned technician records work performed while a job is **In Repair**.
One submit creates one **entry** made of two rows in the `job_progress_logs`
collection that share the same `entryId`:

| Row | `is_public` | `text` | Who sees it |
|---|---|---|---|
| Internal work note | `false` | up to 2000 chars | Technician and Owner/Staff |
| Customer update | `true` | up to 1000 chars | Also the customer |

Both rows record the technician (`recordedBy`), the time (`createdAt`), the
approved estimate (`estimate`, `estimateVersionNumber`) and the job status.
Rows are immutable. Customer APIs only query rows where `is_public: true`.

## Endpoints

| Method | Path | Role |
|---|---|---|
| POST | `/api/technician/jobs/:jobIdentifier/progress-updates` | Assigned technician |
| GET | `/api/technician/jobs/:jobIdentifier/progress-updates` | Assigned technician |
| GET | `/api/staff/jobs/:jobIdentifier/progress-updates` | Owner/Staff (read only) |
| GET | `/api/customer/jobs/:jobIdentifier/progress-updates` | Owning customer |

`/work-notes` is kept as an alias of the technician and staff `/progress-updates` routes.

### POST body

Header `Idempotency-Key: <unique per submit>` is required.

```json
{
  "workNote": "Replaced charging port, tested 19V rail",
  "publicUpdate": "Charging port replaced, testing now",
  "estimateVersionNumber": 1
}
```

Both `workNote` and `publicUpdate` must be non-empty (whitespace only is
rejected). `estimateVersionNumber` is optional; when it is sent and is no longer
the approved version, the request gets 409 `ESTIMATE_SUPERSEDED`.

Correction (a new entry that replaces an earlier one):

```json
{
  "workNote": "Replaced charging port, tested 20V rail",
  "publicUpdate": "Charging port replaced and tested OK",
  "correctionOf": "<entry id being corrected>",
  "correctionReason": "Wrong voltage recorded"
}
```

## Rules

| Situation | Result |
|---|---|
| Saved | 201 `created: true` (two rows written) |
| Same `Idempotency-Key` and same content retried | 200 `idempotentReplay: true`, no duplicate rows |
| Same key, different content | 409 `IDEMPOTENCY_KEY_REUSED` |
| No `Idempotency-Key` header | 400 `IDEMPOTENCY_KEY_REQUIRED` |
| `workNote` / `publicUpdate` empty or too long | 422 `VALIDATION_ERROR` |
| `correctionOf` without `correctionReason` (or reverse) | 422 `VALIDATION_ERROR` |
| Job Awaiting Approval (revised estimate issued) | 409 `REPAIR_LOCKED` |
| Job not In Repair | 409 `INVALID_JOB_STATUS` |
| Parts hold active | 409 `PARTS_HOLD_ACTIVE` |
| Latest estimate not approved | 409 `REPAIR_NOT_AUTHORISED` |
| Stale `estimateVersionNumber` | 409 `ESTIMATE_SUPERSEDED` |
| Entry already corrected | 409 `ALREADY_CORRECTED` |
| Not the assigned technician | 403 `FORBIDDEN` |

The state is rechecked inside the save transaction (status In Repair, same
approved estimate, no parts hold, still assigned). If it changed between the
checks and the save, nothing is written.

## Indexes

- `unique_job_progress_log_entry_visibility` on `{ entryId, is_public }`: exactly one private and one public row per entry.
- `unique_job_progress_log_idempotency` on `{ recordedBy, job, idempotencyKey, is_public }`: no duplicate entry for a retried key.
- `unique_job_progress_log_correction` on `{ correctionOf, is_public }` (partial): one correction per entry.
- `job_progress_log_job_public_idx` on `{ job, is_public, createdAt }`: customer timeline.

## Customer view

Only `is_public: true` rows are returned, as an allow-list: `id`, `message`,
`estimateVersionNumber`, `isCorrection`, `recordedAt`. The internal work note, the
technician and the correction reason are never returned. When an entry has been
corrected, the customer sees only the correction.
