# Start or Resume Repair — Assigned Technician

An assigned technician can start or resume repair work only when it is authorised, so the shop performs only work the customer approved.

## Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| `POST` | `/api/technician/jobs/:jobIdentifier/start-repair` | Assigned technician | Start (from `Approved`) or resume (from `Waiting for Parts`) repair |
| `PATCH` | `/api/staff/jobs/:jobIdentifier/parts-hold/resolve` | Owner/Staff | Parts arrived: resolve the active parts hold |
| `PATCH` | `/api/technician/jobs/:jobIdentifier/parts-hold/resolve` | Assigned technician | Same, from the bench |
| `GET` | `/api/technician/jobs/:jobIdentifier/progress` | Assigned technician | Now also returns `canStartRepair`, `startBlockedReasons` and `workAuthorisation` |

### Start/resume body (all optional)

```json
{
  "estimateVersionNumber": 2,
  "note": "Parts fitted, continuing repair",
  "expectedRevision": 7
}
```

- `estimateVersionNumber`: the approved version shown on the technician's screen. If a newer version exists, the request returns `409 ESTIMATE_SUPERSEDED`.
- `expectedRevision`: the job `revision` the screen was loaded with (`409 STATE_CONFLICT` if the job changed).

### Success (200)

The job moves to `In Repair` and records on `repair_jobs.repairWork`:

| Field | Meaning |
|---|---|
| `lastAction` | `START` or `RESUME` |
| `lastStartedBy` / `lastStartedAt` | Technician and time of this start/resume |
| `approvedEstimate` / `approvedEstimateVersion` | The approved estimate version that authorised the work |
| `firstStartedBy` / `firstStartedAt` | The first start (kept on resume) |

A progress log entry is also written (`repair_progress_updates`) with the technician, time and approved version.

## When start/resume is blocked

| Situation | Response |
|---|---|
| Not the assigned technician (or not a technician) | `403 FORBIDDEN` |
| Latest estimate awaiting customer approval | `409 REPAIR_LOCKED` |
| No estimate issued (approval missing) | `409 REPAIR_NOT_AUTHORISED` "No estimate has been issued…" |
| Latest estimate rejected | `409 REPAIR_NOT_AUTHORISED` "Estimate version N was rejected by the customer…" |
| Screen shows an older version (superseded) | `409 ESTIMATE_SUPERSEDED` |
| Parts hold still active | `409 PARTS_HOLD_ACTIVE` |
| Job `Ready for Collection`, `Ready for Return` or `Collected` | `409 REPAIR_CLOSED` |
| Job already `In Repair`, or any other status | `409 INVALID_STATUS_TRANSITION` with the reason |

## Save-time recheck

The update to `In Repair` is a single conditional database write. It only succeeds if, at the moment of saving, the job still has the same status, revision and current estimate, is still assigned to the technician, and has no active parts hold. A customer decision, a new revision, a new parts hold or a reassignment between the checks and the save makes the write miss, and the request returns `409`.

## Rule change: rejected revisions

Repair is authorised only by an **approved latest** estimate version. When the customer rejects a revision, the job becomes `Estimate Rejected` (it no longer falls back to an earlier approved version). Staff then issue a new revision or return the device.
