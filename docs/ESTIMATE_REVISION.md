# Estimate Revision — Owner/Staff Issues a Revised Estimate

When the work or cost of a repair changes, Owner/Staff issues a new sequential estimate version. The customer must authorise the new version before repair work continues.

## Production endpoints

All endpoints are Owner/Staff only. `jobIdentifier` may be the MongoDB job `_id` or the human-readable reference.

- `GET /api/staff/jobs/:jobIdentifier/estimates`
  - Full version history (oldest first). Each version keeps its lines, total, change reason, status, decision and superseded time.
  - Also returns `revisionEligibility`, `workAuthorisation` and the saved `draftRevision` (if any).
- `PUT /api/staff/jobs/:jobIdentifier/estimate-revisions/draft`
  - Saves (creates or replaces) the single revision draft for the job.
  - Does **not** change the current estimate, the job status or the approved scope.
- `GET /api/staff/jobs/:jobIdentifier/estimate-revisions/draft`
- `DELETE /api/staff/jobs/:jobIdentifier/estimate-revisions/draft`
- `POST /api/staff/jobs/:jobIdentifier/estimate-revisions`
  - Issues the revision as the next version and sets the job to `Awaiting Approval`.

Aliases under `/api/jobs` use the same controller/service:

- `GET /api/jobs/:jobIdentifier/estimates`
- `POST /api/jobs/:jobIdentifier/estimate-revisions`

`GET /api/staff/jobs/:jobIdentifier/estimate-context` now returns the latest version as `currentEstimate` and adds `revisionEligibility`, `hasRevisionDraft` and `workAuthorisation`.

## Issue body

```json
{
  "baseVersionNumber": 1,
  "changeReason": "Battery also found faulty during repair",
  "items": [
    { "type": "PART", "description": "Charging port assembly", "quantity": 1, "unitPrice": "4500.00" },
    { "type": "LABOUR", "description": "Charging port replacement labour", "quantity": 1, "unitPrice": "2500.00" },
    { "type": "PART", "description": "Replacement battery", "quantity": 1, "unitPrice": "8000.00" }
  ]
}
```

- `changeReason` is required to issue (max 1000 characters). It is optional on a draft.
- `items` use exactly the same validation as the initial estimate (SCRUM-14): at least one line, PART/LABOUR, positive whole quantity, non-negative price with at most two decimals, total above LKR 0.00.
- `baseVersionNumber` is optional but recommended. If it is not the current version the request returns `409 STATE_CONFLICT`, so staff never revise an estimate they have not seen.
- To issue the saved draft send `{ "useDraft": true }` (optionally with `changeReason`). A draft saved against an older version returns `409` and must be saved again.
- Lines identical to the current version return `422`: a revision must change the work or cost.
- Retrying the same issued revision returns `200` with `idempotentReplay: true` instead of creating another version.

## Rules

| Rule | Behaviour |
|---|---|
| Eligible jobs | Job has an issued estimate and is not `Ready for Collection`, `Ready for Return` or `Collected` (otherwise `409`). |
| New version | `versionNumber = current + 1`, unique per job, immutable, linked to the replaced version via `basedOnEstimate`. |
| Current estimate | `repair_jobs.currentEstimate` moves to the new version; job status becomes `Awaiting Approval`. |
| History | The replaced version keeps its lines and decision. An undecided version becomes `Superseded`; an `Approved`/`Rejected` version keeps that status. Both get `supersededBy` / `supersededAt`. |
| Customer decision | `POST /api/jobs/:jobIdentifier/estimate-decision` always applies to the latest version. Superseded versions can no longer be decided. |
| Customer view | `GET /api/customer/jobs/:jobIdentifier/current-estimate` shows the latest version with `isRevision`, `revisionReason` and `previousVersionNumber`. Drafts are never visible. |
| Parts hold | Revising a job in `Waiting for Parts` records `repair_jobs.partsHold.active = true` so the hold stays active after the status changes. An existing hold is never cleared by a revision. |
| Work blocked | Repair work and completion are blocked until the latest version is `Approved`. Completion is also blocked while a parts hold is active. |

## Blocking repair work

Repair progress updates are locked while the job is `Awaiting Approval`. See [REPAIR_PROGRESS_LOCK.md](REPAIR_PROGRESS_LOCK.md) for the progress endpoints.

Any other future route that starts, progresses or completes a repair must use the shared guard so work cannot continue on an unapproved revision:

```js
const { requireApprovedLatestEstimate } = require('../middlewares/repairAuthorisationMiddleware');

router.patch('/jobs/:jobIdentifier/start-repair', protect, authorizeRoles('technician'),
  requireApprovedLatestEstimate('REPAIR'), handler);
router.patch('/jobs/:jobIdentifier/complete', protect, authorizeRoles('technician'),
  requireApprovedLatestEstimate('COMPLETE'), handler);
```

A blocked request returns `409` with `code: "REPAIR_NOT_AUTHORISED"`. Services can call `assertRepairWorkAllowed(job, 'REPAIR' | 'COMPLETE')` from `src/services/repairAuthorisationService.js` directly. The technician job detail (`GET /api/technician/jobs/:jobIdentifier`) also returns `workAuthorisation`.

## Database

- `estimates`: new fields `basedOnEstimate`, `supersededBy`, `supersededAt`; status enum adds `Superseded`.
- `estimate_revision_drafts` (new): one draft per job (unique `job` index) with base version, change reason, lines and total.
- `repair_jobs`: new `partsHold { active, reason, placedAt, releasedAt }`.

Run `npm run db:sync-indexes` after pulling to create the draft index. Issuing a revision needs MongoDB transactions (Atlas or a replica set), like the initial estimate.
