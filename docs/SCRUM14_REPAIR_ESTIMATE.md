# SCRUM-14 — Repair Estimate Creation and Issue

This implementation adds the Owner/Staff initial estimate flow without implementing the predecessor Technician screens.

## Production endpoints

- `GET /api/staff/jobs/:jobIdentifier/estimate-context`
  - Owner/Staff only.
  - `jobIdentifier` may be the MongoDB job `_id` or the human-readable reference.
  - Returns intake context, completed-diagnosis context when available, current version 1 when already issued, and eligibility reasons.
- `POST /api/staff/jobs/:jobIdentifier/estimates`
  - Owner/Staff only.
  - Issues immutable version 1 and changes the job to `Awaiting Approval`.
- `POST /api/jobs/:jobIdentifier/estimates`
  - Jira-compatible alias for the exact endpoint named in the SCRUM-14 backend subtask.
  - Uses the same Owner/Staff protection and the same controller/service as the staff-scoped route.

Body example:

```json
{
  "items": [
    {
      "type": "PART",
      "description": "Charging port assembly",
      "quantity": 1,
      "unitPrice": "4500.00"
    },
    {
      "type": "LABOUR",
      "description": "Charging port replacement labour",
      "quantity": 1,
      "unitPrice": "2500.00"
    }
  ]
}
```

The server converts LKR to integer minor units and recalculates all line totals and the grand total. It rejects empty estimates, non-positive/non-integer quantities, negative prices, prices with more than two decimal places, and totals that do not exceed zero.

## Database

New collections:

- `estimates`: job, versionNumber, totalMinor, currency, createdBy, issuedBy, issuedAt, requestHash, immutable flag.
- `estimate_items`: estimate, lineNumber, type, description, quantity, unitPriceMinor, lineTotalMinor, immutable flag.

`repair_jobs` receives two additive fields:

- `currentEstimate`: points to the latest issued estimate.
- `revision`: optimistic workflow revision number.

Version 1 is unique per job. The same exact POST payload can safely be retried and returns the saved version. A changed payload after issue returns `409 STATE_CONFLICT`; issued content is never overwritten.

## SCRUM-12 / SCRUM-13 integration contract

SCRUM-12 (assigned job list) is not a hard backend prerequisite for estimate math/issue, but it is part of the technician path leading to diagnosis.

SCRUM-13 (diagnosis recording) is a hard business prerequisite. SCRUM-14 intentionally does **not** add diagnosis endpoints. It reads the shared `diagnoses` collection through a compatibility repository. The SCRUM-13 branch should preserve:

- Repair job link as `job` or `jobId` ObjectId.
- Completion as a non-null `completedAt` (preferred), or `isCompleted: true` / `diagnosisCompleted: true`.
- Staff context fields should preferably be named `findings`, `recommendedWork`, and `publicSummary`.
- Completing diagnosis must leave the repair job status as `Diagnosing`.

Before merging branches, preserve SCRUM-14 additions to `RepairJob` (`currentEstimate`, `revision`) alongside any assignment/diagnosis fields added by predecessor stories.

## Testing before SCRUM-13 is merged

For local/coursework testing only, prepare an existing SCRUM-9 job with a synthetic completed diagnosis:

```bash
npm run estimate:test-data -- <repairJobId-or-reference>
```

This script requires an existing verified Technician. It changes only the selected test job to `Diagnosing` and upserts a test record into the `diagnoses` collection. Do not use it as a production workflow endpoint.
