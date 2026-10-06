# SCRUM-109 — Customer Public Repair Tracking & History

## User Story & Acceptance Criteria

**User Story:**
> As a customer, I want to track the current status and public history of my repair so that I know what has happened and whether action is required from me.

**Acceptance Criteria:**
- **Given** my job has saved status or public progress events,  
  **When** I open or refresh its status page,  
  **Then** the latest saved status and dated public events appear in chronological order,  
  **And** an `Awaiting Approval` job links to its current estimate decision,  
  **And** `Waiting for Parts` shows the public delay reason,  
  **And** `Ready for Collection` or `Ready for Return` displays the appropriate handover instruction,  
  **And** `Collected` displays the recorded collection time and repaired or unrepaired outcome.
- **Given** I use a 360-pixel-wide mobile viewport,  
  **When** I view the status page,  
  **Then** its main content is readable without horizontal scrolling,  
  **And** customer responses never include internal notes or another customer's records.
- **[BE]** Implement public tracking API endpoint sanitized of internal notes and technician IDs.

---

## Architecture & Code Additions

This feature was implemented cleanly into the layered architecture without affecting existing Customer, Technician, or Staff workflows:

| Layer | File | Responsibilities Added |
| :--- | :--- | :--- |
| **Model** | `src/models/RepairJob.js` | Added `collectionDetailsSchema` with `collectedAt`, `outcome` (`'repaired'` \| `'unrepaired'`), and `notes`. |
| **Service** | `src/services/customerTrackingService.js` | Aggregates job state, public diagnosis summaries, estimate decisions, sanitized delay reasons, handover instructions, collection details, and chronologically sorted public timeline. Strictly sanitizes internal notes and technician IDs. Enforces multi-tenant ownership. |
| **Service** | `src/services/repairProgressService.js` | Added `'Ready for Collection'` -> `'Collected'` and `'Ready for Return'` -> `'Collected'` transitions for Owner/Staff, persisting `collectionDetails` automatically. |
| **Controller** | `src/controllers/customerJobController.js` | Added `getJobTracking` (with `trackJob` alias). |
| **Routes** | `src/routes/customerRoutes.js` | Mounted protected routes `GET /api/customer/jobs/:jobIdentifier/track` and `/tracking`. |
| **Routes** | `src/routes/jobRoutes.js` | Mounted Jira-compatible alias routes `GET /api/jobs/:jobIdentifier/track` and `/tracking`. |

---

## Security & Zero Data Leakage Safeguards

1. **Cross-Customer IDOR Protection**:
   - Customer requests strictly verify `sameId(job.customer, actor._id)`.
   - If a customer queries another customer's job identifier (or a non-existent job), the server responds with **HTTP 404 `NOT_FOUND`** (`Repair job not found`), eliminating any possibility of probing or reading another customer's records.
2. **Sanitization of Internal Notes**:
   - Internal technician notes (`job_progress_logs.text` where `is_public: false`), `Diagnosis.internalNotes`, `Diagnosis.findings`, `Diagnosis.recommendedWork`, and `partsHold.internalNote` are completely excluded from the DTO.
3. **Sanitization of Technician & Staff Identifiers**:
   - Technical and administrative ObjectIds (`assignedTechnician`, `assignedBy`, `startedBy`, `recordedBy`, `updatedBy`, `placedBy`, `releasedBy`) are never included in the customer tracking response.

---

## Production Endpoints

### 1. Customer Tracking Endpoint
`GET /api/customer/jobs/:jobIdentifier/track`  
`GET /api/customer/jobs/:jobIdentifier/tracking` (Alias)  
`GET /api/jobs/:jobIdentifier/track` (Jira-compatible alias)

- **Authentication**: Bearer Token (`customer` or `owner_staff`).
- **Path Parameter**: `:jobIdentifier` accepts either the MongoDB `_id` OR the human-readable job reference (e.g., `JOB-202610-0001`).

---

## Response Payloads by State

### Scenario A: Job In Repair (Public Timeline & Updates)
**HTTP 200 OK**
```json
{
  "job": {
    "id": "67e2a1b4c890123456789abc",
    "reference": "JOB-202610-0001",
    "status": "In Repair",
    "deviceType": "Smartphone",
    "makeModel": "Samsung Galaxy S22",
    "serialNumber": "SN-987654321",
    "reportedFault": "Screen flickering and battery draining quickly",
    "receivedAt": "2026-10-01T10:00:00.000Z",
    "updatedAt": "2026-10-01T11:45:00.000Z"
  },
  "currentStatus": "In Repair",
  "status": "In Repair",
  "actionRequired": false,
  "actionType": null,
  "actionMessage": null,
  "estimateDecision": null,
  "estimateDecisionLink": null,
  "currentEstimateLink": "/api/customer/jobs/JOB-202610-0001/current-estimate",
  "publicDelayReason": null,
  "partsDelay": null,
  "handoverInstruction": null,
  "collection": null,
  "collectedAt": null,
  "collectionTime": null,
  "collectionOutcome": null,
  "publicEvents": [
    {
      "id": "intake-67e2a1b4c890123456789abc",
      "eventType": "INTAKE",
      "status": "Received",
      "title": "Repair Intake Registered",
      "description": "Device received and logged for inspection (Samsung Galaxy S22).",
      "timestamp": "2026-10-01T10:00:00.000Z",
      "date": "2026-10-01T10:00:00.000Z"
    },
    {
      "id": "status-67e2a2c0c890123456789001",
      "eventType": "STATUS_CHANGE",
      "status": "Diagnosing",
      "title": "Diagnosis Started",
      "description": "Device inspection and diagnostic testing initiated.",
      "timestamp": "2026-10-01T10:15:00.000Z",
      "date": "2026-10-01T10:15:00.000Z"
    },
    {
      "id": "diagnosis-67e2a333c890123456789002",
      "eventType": "DIAGNOSIS",
      "status": "Diagnosis Recorded",
      "title": "Diagnosis Completed",
      "description": "Display panel faulty and battery capacity degraded to 64%. Replacement recommended.",
      "timestamp": "2026-10-01T10:30:00.000Z",
      "date": "2026-10-01T10:30:00.000Z"
    },
    {
      "id": "estimate-issued-67e2a444c890123456789003",
      "eventType": "ESTIMATE_ISSUED",
      "status": "Awaiting Approval",
      "title": "Repair Estimate Issued (v1)",
      "description": "Repair estimate of LKR 29,000.00 issued for customer review.",
      "timestamp": "2026-10-01T10:45:00.000Z",
      "date": "2026-10-01T10:45:00.000Z"
    },
    {
      "id": "estimate-decision-67e2a444c890123456789003",
      "eventType": "ESTIMATE_APPROVED",
      "status": "Approved",
      "title": "Estimate Approved (v1)",
      "description": "Customer approved estimate version 1.",
      "timestamp": "2026-10-01T11:00:00.000Z",
      "date": "2026-10-01T11:00:00.000Z"
    },
    {
      "id": "status-67e2a555c890123456789004",
      "eventType": "STATUS_CHANGE",
      "status": "In Repair",
      "title": "Repair Started",
      "description": "Technician commenced repair work under approved estimate.",
      "timestamp": "2026-10-01T11:15:00.000Z",
      "date": "2026-10-01T11:15:00.000Z"
    },
    {
      "id": "progress-67e2a666c890123456789005",
      "eventType": "PROGRESS_UPDATE",
      "status": "In Repair",
      "title": "Work Progress Update",
      "description": "Display panel replaced. Undergoing calibration and touch sensitivity tests.",
      "timestamp": "2026-10-01T11:45:00.000Z",
      "date": "2026-10-01T11:45:00.000Z"
    }
  ],
  "timelineCount": 7
}
```

---

### Scenario B: Awaiting Approval (Action Required & Estimate Decision Links)
**HTTP 200 OK**
```json
{
  "currentStatus": "Awaiting Approval",
  "status": "Awaiting Approval",
  "actionRequired": true,
  "actionType": "ESTIMATE_DECISION",
  "actionMessage": "Your approval is required for the repair estimate before work can proceed.",
  "estimateDecision": {
    "estimateId": "67e2a444c890123456789003",
    "versionNumber": 1,
    "total": "29000.00",
    "totalMinor": 2900000,
    "status": "Issued",
    "canDecide": true,
    "decisionUrl": "/api/jobs/JOB-202610-0001/estimate-decision",
    "viewEstimateUrl": "/api/customer/jobs/JOB-202610-0001/current-estimate"
  },
  "estimateDecisionLink": "/api/jobs/JOB-202610-0001/estimate-decision",
  "currentEstimateLink": "/api/customer/jobs/JOB-202610-0001/current-estimate"
}
```

---

### Scenario C: Waiting for Parts (Public Delay Reason)
**HTTP 200 OK**
```json
{
  "currentStatus": "Waiting for Parts",
  "status": "Waiting for Parts",
  "publicDelayReason": "Awaiting OEM replacement AMOLED panel from certified supplier.",
  "partsDelay": {
    "requiredPart": "OEM AMOLED Display Panel",
    "reason": "Awaiting OEM replacement AMOLED panel from certified supplier.",
    "publicDelayReason": "Awaiting OEM replacement AMOLED panel from certified supplier.",
    "placedAt": "2026-10-01T12:00:00.000Z"
  }
}
```

---

### Scenario D: Ready for Collection (Collection Handover Instruction)
**HTTP 200 OK**
```json
{
  "currentStatus": "Ready for Collection",
  "status": "Ready for Collection",
  "handoverInstruction": "Your device repair has been completed and quality tested. It is ready for collection at our service centre. Please bring your repair reference (JOB-202610-0001) and a valid photo ID to collect your device. Any balance due can be settled upon collection."
}
```

---

### Scenario E: Ready for Return (Unrepaired Return Handover Instruction)
**HTTP 200 OK**
```json
{
  "currentStatus": "Ready for Return",
  "status": "Ready for Return",
  "handoverInstruction": "Your device is ready for return unrepaired. Please visit our service centre with your repair reference (JOB-202610-0001) and a valid photo ID to collect your device."
}
```

---

### Scenario F: Collected (Collection Time & Outcome)
**HTTP 200 OK**
```json
{
  "currentStatus": "Collected",
  "status": "Collected",
  "collection": {
    "collectedAt": "2026-10-01T16:30:00.000Z",
    "collectionTime": "2026-10-01T16:30:00.000Z",
    "outcome": "repaired",
    "outcomeDescription": "Device was successfully repaired and collected by customer."
  },
  "collectedAt": "2026-10-01T16:30:00.000Z",
  "collectionTime": "2026-10-01T16:30:00.000Z",
  "collectionOutcome": "repaired"
}
```

---

### Scenario G: Cross-Customer Access Attempt (IDOR Protection)
**HTTP 404 NOT FOUND**
```json
{
  "message": "Repair job not found"
}
```
*(No data disclosure occurs; requesting an unauthorized job is indistinguishable from a non-existent job reference.)*
