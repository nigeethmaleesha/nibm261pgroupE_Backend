# SCRUM-120 — Customer Device Handover & Collected Immutability

## User Story & Acceptance Criteria

**User Story:**
> As an Owner/Staff member, I want to record handing a ready device back to its customer so that the repair job has a traceable final handover and outcome.

**Acceptance Criteria:**
- **Given** a job is `Ready for Collection` or `Ready for Return`,  
  **When** Owner/Staff confirms the linked customer's identity and that the device was handed over,  
  **Then** the job becomes `Collected` and stores the staff member and collection time,  
  **And** the outcome is `Repaired` for `Ready for Collection` or `Unrepaired` for `Ready for Return`,  
  **And** the closed job, its estimates and its history become read-only.
- **Given** a job is not in a ready state or the requester is not Owner/Staff,  
  **When** collection is attempted,  
  **Then** the server refuses the action,  
  **And** repeating the same successful handover request returns the existing result without another collection event.
- **[BE]** Implement `POST /api/staff/jobs/:id/handover` setting status to `Collected` with timestamp and outcome.
- **[DB]** Apply database trigger or service-layer lock making `Collected` jobs immutable.

---

## Architecture & Code Additions

This feature was implemented cleanly into the layered architecture without breaking existing Customer, Technician, or Staff workflows:

| Layer | File | Responsibilities Added |
| :--- | :--- | :--- |
| **Model** | `src/models/RepairJob.js` | Updated `collectionDetailsSchema` with `collectedBy` (User ref), `customerIdentityConfirmed` (Boolean), `deviceHandedOver` (Boolean), `outcome` (`'repaired'` \| `'unrepaired'`), and `notes`. Added database trigger pre-hooks preventing mutation or deletion of `Collected` jobs. |
| **Model** | `src/models/RepairProgressUpdate.js` | Added Mongoose immutability pre-hooks preventing deletion or modification of repair progress history records. |
| **Model** | `src/models/JobProgressLog.js` | Added Mongoose immutability pre-hooks preventing deletion or modification of technician work notes and updates. |
| **Repository** | `src/repositories/repairJobRepository.js` | Added `recordHandover` atomic update operation guarded by ready statuses (`Ready for Collection`, `Ready for Return`) and optimistic revision counter. |
| **Service** | `src/services/repairProgressService.js` | Implemented `recordHandover`: enforces `owner_staff` role, validates identity and device handover confirmation flags, sets status to `Collected`, determines `repaired`/`unrepaired` outcome, creates audit progress update, cancels lingering revision drafts, triggers email confirmation, and handles idempotent replay. |
| **Service** | `src/services/emailService.js` | Added `sendRepairCollectedEmail` to dispatch immediate handover confirmation emails to customers. |
| **Controller** | `src/controllers/repairProgressController.js` | Added `recordHandover` request handler. |
| **Routes** | `src/routes/staffRoutes.js` | Mounted protected routes `POST /api/staff/jobs/:jobIdentifier/handover` and `POST /api/staff/jobs/:id/handover`. |
| **Routes** | `src/routes/jobRoutes.js` | Mounted Jira-compatible alias route `POST /api/jobs/:jobIdentifier/handover`. |

---

## Database Triggers & Immutability Architecture

To satisfy **`[DB] Apply database trigger or service-layer lock making Collected jobs immutable`**, protection was implemented at both the schema/database layer and service layer:

### 1. Database-Level Mongoose Triggers (`src/models/RepairJob.js`)
- **Pre-Save Trigger**:
  Checks if document is being updated after reaching `status: 'Collected'`. If the document in the database was already `Collected`, an error is thrown:
  ```javascript
  repairJobSchema.pre('save', async function () {
    if (!this.isNew) {
      const existing = await this.constructor.findById(this._id).select('status').lean();
      if (existing && existing.status === 'Collected') {
        const err = new Error('Collected repair jobs are immutable and cannot be modified.');
        err.codeName = 'REPAIR_CLOSED';
        err.statusCode = 409;
        throw err;
      }
    }
  });
  ```
- **Pre-Update Trigger (`updateOne`, `updateMany`, `findOneAndUpdate`)**:
  Inspects the matching document before executing updates. If the targeted document's status in the database is `Collected`, the query is blocked with HTTP 409 `REPAIR_CLOSED`.
- **Pre-Delete Trigger (`deleteOne`, `deleteMany`, `findOneAndDelete`, `findOneAndRemove`)**:
  Prevents deleting any repair job that has reached `Collected`.

### 2. Audit Trail & History Immutability
- `RepairProgressUpdate` and `JobProgressLog` schemas enforce read-only immutability hooks (`deleteOne`, `updateMany`, `findOneAndUpdate`, etc.), ensuring the entire chronological lifecycle cannot be tampered with.

### 3. Service-Layer Workflow Locks
- Transition from `Collected` to any other status is disallowed. `TRANSITIONS['Collected']` is empty.
- Estimate issuance, technician re-assignment, parts holds, diagnosis, and progress notes strictly reject `Collected` jobs with `409 REPAIR_CLOSED` or `STATE_CONFLICT`.

---

## Production Endpoints

### 1. Staff Device Handover Endpoint
`POST /api/staff/jobs/:id/handover`  
`POST /api/staff/jobs/:jobIdentifier/handover` (Alias)  
`POST /api/jobs/:jobIdentifier/handover` (Jira-compatible alias)

- **Authentication**: Bearer Token (`owner_staff`).
- **Path Parameter**: `:id` / `:jobIdentifier` accepts either the MongoDB `_id` OR the human-readable job reference (e.g., `JOB-202610-0001`).
- **Headers**:
  ```http
  Authorization: Bearer <owner_staff_jwt_token>
  Content-Type: application/json
  ```

---

## Request & Response Payloads

### Request Payload Specification
```json
{
  "customerIdentityConfirmed": true,
  "deviceHandedOver": true,
  "notes": "Customer presented National Identity Card and settled repair payment."
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `customerIdentityConfirmed` | Boolean | **Yes** | Confirmation that staff verified the linked customer's identity (also accepts alias `identityConfirmed`). |
| `deviceHandedOver` | Boolean | **Yes** | Confirmation that the physical device was handed back to the customer (also accepts alias `confirmHandover`). |
| `notes` | String | No | Optional staff handover notes (max 500 characters). |
| `expectedRevision` | Number | No | Optional optimistic concurrency revision counter. |

---

### Scenario A: Handover from `Ready for Collection` (Outcome: `Repaired`)
**HTTP 200 OK**
```json
{
  "success": true,
  "message": "Device successfully handed over to customer (Repaired). Repair job is now Collected and read-only.",
  "job": {
    "id": "67e2a1b4c890123456789abc",
    "reference": "JOB-202610-0001",
    "status": "Collected",
    "deviceType": "Smartphone",
    "makeModel": "Apple iPhone 13",
    "serialNumber": "SN-IPHONE13-001",
    "reportedFault": "Cracked screen and damaged digitizer",
    "receivedAt": "2026-10-01T10:00:00.000Z",
    "collectionDetails": {
      "collectedAt": "2026-10-03T10:30:00.000Z",
      "collectedBy": "67e29000a123456789abcdef",
      "customerIdentityConfirmed": true,
      "deviceHandedOver": true,
      "outcome": "repaired",
      "notes": "Customer presented National Identity Card and settled repair payment."
    },
    "revision": 3,
    "updatedAt": "2026-10-03T10:30:00.000Z"
  },
  "update": {
    "id": "67e2f999c890123456789def",
    "jobId": "67e2a1b4c890123456789abc",
    "fromStatus": "Ready for Collection",
    "toStatus": "Collected",
    "note": "Device collected by customer (Repaired). Notes: Customer presented National Identity Card and settled repair payment.",
    "updatedBy": "67e29000a123456789abcdef",
    "updatedByRole": "owner_staff",
    "createdAt": "2026-10-03T10:30:00.000Z"
  }
}
```

---

### Scenario B: Handover from `Ready for Return` (Outcome: `Unrepaired`)
**HTTP 200 OK**
```json
{
  "success": true,
  "message": "Device successfully handed over to customer (Unrepaired). Repair job is now Collected and read-only.",
  "job": {
    "id": "67e2a1b4c890123456789abc",
    "reference": "JOB-202610-0002",
    "status": "Collected",
    "collectionDetails": {
      "collectedAt": "2026-10-03T10:35:00.000Z",
      "collectedBy": "67e29000a123456789abcdef",
      "customerIdentityConfirmed": true,
      "deviceHandedOver": true,
      "outcome": "unrepaired",
      "notes": "Device returned unrepaired following customer request."
    }
  }
}
```

---

### Scenario C: Idempotent Replay (Repeating Request on Already Collected Job)
**HTTP 200 OK**
```json
{
  "success": true,
  "message": "Device handover has already been recorded for this repair job.",
  "job": {
    "id": "67e2a1b4c890123456789abc",
    "reference": "JOB-202610-0001",
    "status": "Collected",
    "collectionDetails": {
      "collectedAt": "2026-10-03T10:30:00.000Z",
      "collectedBy": "67e29000a123456789abcdef",
      "customerIdentityConfirmed": true,
      "deviceHandedOver": true,
      "outcome": "repaired",
      "notes": "Customer presented National Identity Card and settled repair payment."
    }
  },
  "alreadyCollected": true
}
```

---

### Error Responses

#### 1. Missing Customer Identity Confirmation
**HTTP 422 Unprocessable Entity**
```json
{
  "error": {
    "message": "You must confirm the customer's identity before completing handover",
    "codeName": "VALIDATION_ERROR",
    "statusCode": 422
  }
}
```

#### 2. Missing Device Handover Confirmation
**HTTP 422 Unprocessable Entity**
```json
{
  "error": {
    "message": "You must confirm that the device has been handed over to the customer",
    "codeName": "VALIDATION_ERROR",
    "statusCode": 422
  }
}
```

#### 3. Job Not in Ready State (e.g., In Repair or Received)
**HTTP 409 Conflict**
```json
{
  "error": {
    "message": "Handover can only be recorded when the job is Ready for Collection or Ready for Return (current: In Repair)",
    "codeName": "INVALID_STATUS",
    "statusCode": 409,
    "details": {
      "currentStatus": "In Repair",
      "allowedStatuses": ["Ready for Collection", "Ready for Return"]
    }
  }
}
```

#### 4. Unauthorized Role (e.g. Technician or Customer attempt)
**HTTP 403 Forbidden**
```json
{
  "error": {
    "message": "Forbidden. Requires one of roles: owner_staff",
    "statusCode": 403
  }
}
```

---

## Verification & Automated Test Suite

Run the dedicated test suite:
```bash
npm run handover:test
```

### Verified Test Cases:
1. `Ready for Collection -> Collected`: Confirms outcome is `repaired`, staff member ID is stored, and timestamp is captured.
2. `Ready for Return -> Collected`: Confirms outcome is `unrepaired`.
3. Customer Identity Confirmation: Refuses handover with HTTP 422 when `customerIdentityConfirmed` is false or omitted.
4. Device Handover Confirmation: Refuses handover with HTTP 422 when `deviceHandedOver` is false or omitted.
5. Non-Ready State Rejection: Refuses handover with HTTP 409 when status is `In Repair`, `Received`, `Diagnosing`, or `Waiting for Parts`.
6. Role-Based Access Control: Refuses request with HTTP 403 for non-Owner/Staff actors.
7. Idempotent Replay: Retrying handover on a `Collected` job safely returns HTTP 200 with `alreadyCollected: true` and zero duplicate progress update logs.
8. Database Immutability Trigger: Proves that `RepairJob`, `RepairProgressUpdate`, and `JobProgressLog` reject any post-collection mutation or deletion.
