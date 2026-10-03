# SCRUM-125 — Customer Completed Repair Records & History

## User Story & Acceptance Criteria

**User Story:**
> As a customer, I want to view my completed repair records so that I can refer to the repair outcome and collection details after handover.

**Acceptance Criteria:**
- **Given** I have one or more `Collected` repair jobs,  
  **When** I open my completed repair records and select a job,  
  **Then** I see its reference, device, public repair summary or return reason, outcome and collection time,  
  **And** I can view its issued estimate versions and my recorded decisions,  
  **And** the record remains available after logging out and logging back in.
- **Given** another customer's closed job exists or I attempt to edit a closed record,  
  **When** I request it directly or submit a change,  
  **Then** the server denies the unauthorised read or edit,  
  **And** internal diagnosis and work notes are excluded from my view.
- **[BE]** Implement `GET /api/customer/jobs/history` scoped to authenticated customer.

---

## Architecture & Code Changes

The feature is implemented within RepairFlow's layered architecture to maintain clear separation of concerns, zero data leakage, and strong multi-tenant authorization:

| Layer | File | Changes & Responsibilities |
| :--- | :--- | :--- |
| **Repository** | `src/repositories/repairJobRepository.js` | Added `findCompletedByCustomer(customerId)` querying `{ customer: customerId, status: 'Collected' }` sorted by collection time and updated timestamp descending. |
| **Service** | `src/services/customerTrackingService.js` | Added: <br>• `serializeCustomerEstimate`: Serializes estimate version, status, total, change reason, recorded customer decision, and items.<br>• `formatCompletedJobSummary`: Transforms internal document into a sanitized completed DTO featuring reference, device, public summary or return reason, outcome (`repaired`/`unrepaired`), outcomeDisplay, outcomeDescription, collectionTime (`collectedAt`), and estimate history.<br>• `getCompletedHistory`: Handles listing all completed jobs for the customer, or delegating to detail if a jobIdentifier is passed.<br>• `getCompletedJobDetail`: Returns detailed view of a selected completed job with public timeline events and estimate history, enforcing ownership and Collected status. |
| **Controller** | `src/controllers/customerJobController.js` | Added and exported `getCompletedHistory` and `getCompletedJobDetail` request handlers. |
| **Routes** | `src/routes/customerRoutes.js` | Mounted protected routes:<br>• `GET /api/customer/jobs/history`<br>• `GET /api/customer/jobs/:jobIdentifier/history` |
| **Routes** | `src/routes/jobRoutes.js` | Mounted Jira-compatible alias route:<br>• `GET /api/jobs/:jobIdentifier/completed` |
| **Tests** | `scripts/testCustomerCompletedHistory.js` | Comprehensive 6-test automated verification suite covering list retrieval, unrepaired return reason, detail view, cross-customer IDOR protection, non-collected job refusal, and zero data leakage. |
| **Package** | `package.json` | Registered `history:test` script (`node scripts/testCustomerCompletedHistory.js`) and added it to `npm run check`. |

---

## Security, Immutability & Zero Data Leakage

### 1. Scoped Authentication & Session Persistence
- All customer history endpoints require an authenticated customer session via `verifyAuthCookie` and `requireRole('customer')`.
- Sessions are backed by HttpOnly cookies and database refresh-token sessions. Records remain permanently available across logout and re-login because queries are bound to `req.user._id` in the database.

### 2. Multi-Tenant IDOR Protection
- When fetching completed jobs or details by reference or ID, the database query strictly includes `{ customer: req.user._id }`.
- If a customer attempts to query another customer's closed job directly by ID or reference, the service responds with `404 NOT_FOUND` (`Completed repair record not found`). This prevents attackers from enumerating or discovering other customers' jobs.

### 3. Read-Only Immutability on Closed Records
- Closed jobs (`Collected`) are locked against modification via Mongoose database pre-save and pre-update triggers (`REPAIR_CLOSED` with HTTP 409).
- Customers have no update endpoints, and any staff or technician mutation attempt on a collected job is rejected at both the service layer and database layer.

### 4. Zero Data Leakage & Public-Safe Sanitization
The response DTO explicitly excludes:
- `Diagnosis.internalNotes`
- `Diagnosis.findings`
- `Diagnosis.recommendedWork`
- `job_progress_logs` where `is_public: false` (internal technician notes)
- Internal staff notes recorded during handover
- Technical ObjectIds (`assignedTechnician`, `collectedBy`, `customer`, `_id` of internal logs)

Only the customer-facing `publicRepairSummary` (or `returnReason` / `returnNotes` if unrepaired) is presented.

---

## API Endpoints Specification

### 1. List Completed Repair Records
- **Route**: `GET /api/customer/jobs/history`
- **Auth**: Bearer / HttpOnly Cookie (`customer`)
- **Query Params (Optional)**:
  - `jobIdentifier`: If provided, returns detail for the specified job.

#### Sample Response (`200 OK`):
```json
{
  "status": "success",
  "data": {
    "count": 2,
    "jobs": [
      {
        "reference": "JOB-202610-0001",
        "device": {
          "brand": "Apple",
          "model": "iPhone 13",
          "serialNumber": "SN-IPHONE13-001"
        },
        "reportedFault": "Battery drains very fast and device overheats",
        "status": "Collected",
        "outcome": "repaired",
        "outcomeDisplay": "Repaired",
        "outcomeDescription": "The device was successfully repaired and returned to you in working order.",
        "collectedAt": "2026-10-03T05:30:00.000Z",
        "collectionTime": "2026-10-03T05:30:00.000Z",
        "publicRepairSummary": "Replaced battery pack and performed full thermal test.",
        "returnReason": null,
        "returnNotes": null,
        "latestEstimate": {
          "versionNumber": 1,
          "status": "Approved",
          "currency": "LKR",
          "total": "28500.00",
          "changeReason": "Initial repair estimate",
          "customerDecision": {
            "action": "APPROVED",
            "decidedAt": "2026-10-02T10:00:00.000Z"
          },
          "items": [
            {
              "description": "OEM Battery Pack",
              "quantity": 1,
              "unitPrice": "22500.00",
              "totalPrice": "22500.00"
            },
            {
              "description": "Labour & Waterproof Seal",
              "quantity": 1,
              "unitPrice": "6000.00",
              "totalPrice": "6000.00"
            }
          ]
        },
        "estimateHistory": [
          {
            "versionNumber": 1,
            "status": "Approved",
            "currency": "LKR",
            "total": "28500.00",
            "customerDecision": {
              "action": "APPROVED",
              "decidedAt": "2026-10-02T10:00:00.000Z"
            }
          }
        ]
      }
    ]
  }
}
```

---

### 2. Get Completed Job Record Detail
- **Route**: `GET /api/customer/jobs/:jobIdentifier/history`
- **Alias**: `GET /api/jobs/:jobIdentifier/completed`
- **Auth**: Bearer / HttpOnly Cookie (`customer`)
- **Params**: `jobIdentifier` (job reference e.g. `JOB-202610-0001` or MongoDB ObjectId)

#### Sample Response (`200 OK` for Unrepaired Job):
```json
{
  "status": "success",
  "data": {
    "reference": "JOB-202610-0002",
    "device": {
      "brand": "Samsung",
      "model": "Galaxy S22",
      "serialNumber": "SN-S22-002"
    },
    "reportedFault": "Water damaged motherboard",
    "status": "Collected",
    "outcome": "unrepaired",
    "outcomeDisplay": "Unrepaired",
    "outcomeDescription": "The device was returned without repair per your instructions or feasibility assessment.",
    "collectedAt": "2026-10-03T05:45:00.000Z",
    "collectionTime": "2026-10-03T05:45:00.000Z",
    "publicRepairSummary": null,
    "returnReason": "Customer rejected estimate for mainboard replacement.",
    "returnNotes": "Customer decided to purchase a new device instead.",
    "estimateHistory": [
      {
        "versionNumber": 1,
        "status": "Rejected",
        "currency": "LKR",
        "total": "65000.00",
        "changeReason": "Initial motherboard replacement estimate",
        "customerDecision": {
          "action": "REJECTED",
          "decidedAt": "2026-10-02T11:00:00.000Z"
        },
        "items": [
          {
            "description": "Mainboard Assembly",
            "quantity": 1,
            "unitPrice": "65000.00",
            "totalPrice": "65000.00"
          }
        ]
      }
    ],
    "publicEvents": [
      {
        "type": "INTAKE",
        "title": "Device Received",
        "description": "Device received and logged for diagnosis.",
        "timestamp": "2026-10-01T08:00:00.000Z"
      },
      {
        "type": "ESTIMATE_ISSUED",
        "title": "Estimate Issued (v1)",
        "description": "Estimate of LKR 65000.00 issued for customer review.",
        "timestamp": "2026-10-02T09:00:00.000Z"
      },
      {
        "type": "ESTIMATE_DECISION",
        "title": "Estimate Rejected",
        "description": "Customer rejected estimate version 1.",
        "timestamp": "2026-10-02T11:00:00.000Z"
      },
      {
        "type": "HANDOVER",
        "title": "Device Collected",
        "description": "Device handed over to customer (Unrepaired).",
        "timestamp": "2026-10-03T05:45:00.000Z"
      }
    ]
  }
}
```

---

## Automated Verification

Run the test suite:
```bash
npm run history:test
```

### Verified Test Cases:
1. **Test 1**: Customer successfully views list of completed repair records with estimates, items, and recorded decisions.
2. **Test 2**: Unrepaired completed job displays return reason, return notes, and unrepaired outcome display.
3. **Test 3**: Customer views detail of selected completed job with public timeline events.
4. **Test 4**: Cross-customer IDOR protection strictly denies unauthorized access with `404 NOT_FOUND`.
5. **Test 5**: Non-collected jobs requested via completed history detail endpoint are rejected with `400 JOB_NOT_COLLECTED`.
6. **Test 6**: Zero data leakage verification confirms 100% absence of internal technician/staff notes, findings, or actor ObjectIds.
