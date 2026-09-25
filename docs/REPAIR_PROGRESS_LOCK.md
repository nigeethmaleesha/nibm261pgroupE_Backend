# Repair Progress Lock — No Progress While Awaiting Approval

Repair progress (status changes and progress notes) is locked while a job is `Awaiting Approval`. This happens after the initial estimate is issued and again every time a revised estimate is issued. Progress unlocks only when the customer approves the latest estimate version.

## Endpoints

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/technician/jobs/:jobIdentifier/progress` | Assigned technician |
| `PATCH` | `/api/technician/jobs/:jobIdentifier/progress` | Assigned technician |
| `GET` | `/api/staff/jobs/:jobIdentifier/progress` | Owner/Staff |
| `PATCH` | `/api/staff/jobs/:jobIdentifier/progress` | Owner/Staff |

`jobIdentifier` may be the MongoDB `_id` or the job reference. A technician gets `403` for a job not assigned to them.

### PATCH body

```json
{
  "status": "In Repair",
  "note": "Replaced charging port, testing now",
  "expectedRevision": 4
}
```

- `status` (optional): the new job status.
- `note` (optional, max 1000 characters): a progress note. Send a note without `status` to log progress without changing status.
- At least one of `status` or `note` is required.
- `expectedRevision` (optional, recommended): the job `revision` the screen was loaded with. If the job changed since then the request returns `409 STATE_CONFLICT`.

### GET response

Returns the job (status, revision, parts hold), `isLocked`, the statuses the caller may move to (`allowedStatuses`, empty while locked), and the progress log newest first.

## The lock

| Situation | Result |
|---|---|
| Job is `Awaiting Approval` (any status change or note, technician or staff) | `409` `code: "REPAIR_LOCKED"` with `details.awaitingVersionNumber` |
| A revised estimate is issued while someone is submitting progress | The job update is conditional on the job's status, revision and current estimate, so it misses and returns `409 REPAIR_LOCKED`. Progress can never be saved against a superseded estimate. |
| Latest estimate not approved for any other reason | `409` `code: "REPAIR_NOT_AUTHORISED"` |

Example locked response:

```json
{
  "message": "Repair progress is locked while estimate version 2 is awaiting customer approval",
  "code": "REPAIR_LOCKED",
  "details": {
    "jobStatus": "Awaiting Approval",
    "awaitingVersionNumber": 2,
    "reason": "The customer must approve the latest estimate before repair progress can be updated"
  }
}
```

## Allowed status changes

| From | To | Rule |
|---|---|---|
| `Approved` | `In Repair` | Latest estimate approved. Blocked with `409 PARTS_HOLD_ACTIVE` if a parts hold is active. |
| `Approved` | `Waiting for Parts` | Latest estimate approved |
| `In Repair` | `Waiting for Parts` | Places a parts hold (reason = note) |
| `Waiting for Parts` | `In Repair` | Releases the parts hold |
| `In Repair` | `Ready for Collection` | Completion: latest estimate approved **and** no active parts hold |
| `Estimate Rejected` | `Ready for Return` | Owner/Staff only. Device returned unrepaired, so no approval needed. |

Anything else returns `409 INVALID_STATUS_TRANSITION` with `details.allowedStatuses`. Notes without a status change are allowed in `Approved`, `In Repair` and `Waiting for Parts`.

A parts hold that was active when a revision was issued stays active. After the customer approves, move the job to `Waiting for Parts` and then to `In Repair` when the parts arrive.

## Database

- `repair_progress_updates` (new): one immutable entry per accepted update with `fromStatus`, `toStatus`, `note`, the approved `estimateVersionNumber`, `updatedBy` and `updatedByRole`. Rejected (locked) attempts are not stored.

Mongoose creates the new index automatically when the server starts. Avoid `npm run db:sync-indexes` on a branch that does not contain every teammate's models: it removes indexes the branch does not define from the shared database.
