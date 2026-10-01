# SCRUM-13 — Diagnosis Recording

This implementation adds the diagnosis workflow for an assigned technician while preserving all previously completed RepairFlow flows.

## Jira user story

> As an assigned technician, I want to record diagnosis findings and recommended repairs so that Owner/Staff can prepare an estimate based on the device's actual condition.

## Implemented acceptance behaviour

- An assigned technician can start diagnosis only while the repair job is `Received`.
- Starting diagnosis changes `RepairJob.status` from `Received` to `Diagnosing` and records the technician and start time.
- A single diagnosis record is stored per repair job in the `diagnoses` collection.
- While the job is `Diagnosing`, the assigned technician can save a draft containing:
  - diagnosis findings,
  - recommended work,
  - customer-safe summary,
  - internal technical notes,
  - an optional `Unrepairable` flag and reason.
- Completion is rejected unless findings, recommended work and the customer-safe summary are all present.
- When `Unrepairable` is selected, the reason is also mandatory.
- A completed diagnosis is immutable through the technician API.
- A technician who is not currently assigned to the job receives `403` and cannot read or overwrite its diagnosis.
- Jobs beyond the diagnosis phase cannot be edited through diagnosis endpoints.
- Owner/Staff can read the completed technical diagnosis for estimate preparation.
- Customer-facing diagnosis responses are generated from an allow-list DTO and never contain `internalNotes`, technical findings, recommendations, or technician IDs.

## Important integration decision

The current repository already contains the completed SCRUM-14 estimate flow. SCRUM-14 requires the repair job's global `status` to remain `Diagnosing` until the initial estimate is issued. To avoid breaking that completed work, SCRUM-13 uses the additive `RepairJob.diagnosisState` field for the second diagnosis transition:

- Global workflow: `Received` -> `Diagnosing`
- Diagnosis lifecycle: `Diagnosing` -> `Diagnosis Recorded`

After completion:

- `RepairJob.status` remains `Diagnosing`
- `RepairJob.diagnosisState` becomes `Diagnosis Recorded`
- `diagnosis.state` becomes `Diagnosis Recorded`
- `diagnosis.completedAt` is populated

This preserves the existing estimate eligibility contract while still recording the requested diagnosis state transition.

## Production endpoints

### Technician

- `GET /api/technician/jobs/:jobIdentifier/diagnosis`
- `POST /api/technician/jobs/:jobIdentifier/diagnosis/start`
- `PATCH /api/technician/jobs/:jobIdentifier/diagnosis`

Example draft/completion payload:

```json
{
  "findings": "Charging input drops under connector movement.",
  "recommendedWork": "Replace charging port assembly and retest.",
  "publicSummary": "Testing confirmed a damaged charging assembly.",
  "internalNotes": "Bench-only voltage notes.",
  "isUnrepairable": false,
  "unrepairableReason": null,
  "complete": true
}
```

### Owner/Staff

- `GET /api/staff/jobs/:jobIdentifier/diagnosis`

The existing SCRUM-14 `GET /api/staff/jobs/:jobIdentifier/estimate-context` automatically sees the completed diagnosis because it reads the same `diagnoses` collection.

### Customer-safe response

- `GET /api/customer/jobs/:jobIdentifier/diagnosis`

Returned diagnosis fields are restricted to:

```json
{
  "state": "Diagnosis Recorded",
  "publicSummary": "...",
  "isUnrepairable": false,
  "completedAt": "..."
}
```

## Frontend

The technician full work-order page now contains a Diagnosis Recording workspace with:

- Start Diagnosis action
- Diagnosis Findings
- Recommended Work
- Customer-safe Summary
- Internal Technical Notes
- Unrepairable toggle + reason
- Save Draft
- Complete Diagnosis
- Completed/locked read-only state

The existing technician detail modal now includes an **Open Diagnosis Workspace** action. Existing dashboard, assignment, estimate, auth, and repair-progress UI behaviour is unchanged.

## Postman

The collection contains a new folder: **Diagnosis Recording (SCRUM-13)** with requests covering start, draft save, completion, required-field validation, immutable completion, staff access, customer-safe projection, and unassigned-technician access denial.

Two optional variables are included for negative tests:

- `diagnosisFreshJobReference`
- `otherTechnicianJobReference`

Run `npm run db:sync-indexes` once after deployment to create the unique diagnosis index.
