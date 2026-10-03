# SCRUM-125: Customer Completed Repair Records & History

## Overview
This directory contains the documentation and architectural specifications for **SCRUM-125**: allowing authenticated customers to securely view their completed repair records after handover.

---

## Story Specification
- **Story ID**: SCRUM-125
- **Title**: Customer Completed Repair Records & History
- **Actor**: Customer (`customer`)
- **Key Endpoint**: `GET /api/customer/jobs/history`
- **Detail Endpoint**: `GET /api/customer/jobs/:jobIdentifier/history`
- **Jira Alias Route**: `GET /api/jobs/:jobIdentifier/completed`

---

## Acceptance Criteria
1. **Completed Records Retrieval**:
   - Given a customer has one or more `Collected` repair jobs,
   - When the customer requests completed repair records or selects a specific job,
   - Then the response includes:
     - Reference (`reference`)
     - Device details (`brand`, `model`, `serialNumber`)
     - Reported fault
     - Public repair summary (`publicRepairSummary`) for repaired devices, OR return reason (`returnReason`, `returnNotes`) for unrepaired devices
     - Handover outcome (`repaired` | `unrepaired`), human-friendly display label, and explanatory description
     - Collection timestamp (`collectedAt` / `collectionTime`)
     - All issued estimate versions and the customer's recorded decisions (`APPROVED` / `REJECTED`, timestamp)
2. **Session Persistence**:
   - Records remain available across sessions (after logging out and logging back in).
3. **Multi-Tenant IDOR Protection**:
   - When requesting another customer's closed job or attempting unauthorized access, the server returns `404 NOT_FOUND` (`Completed repair record not found`).
4. **Immutability of Closed Records**:
   - Attempting to modify or mutate a collected job is rejected by database triggers and service-layer locks (`409 REPAIR_CLOSED`).
5. **Zero Data Leakage**:
   - Internal diagnosis notes (`Diagnosis.internalNotes`), raw technical findings (`Diagnosis.findings`), recommended technician work (`Diagnosis.recommendedWork`), and private work notes (`job_progress_logs` where `is_public: false`) are strictly filtered out and excluded from customer responses.
   - Staff member IDs and technician ObjectIds are completely omitted.

---

## File Implementation Map
- **Repository**: `src/repositories/repairJobRepository.js` (`findCompletedByCustomer`)
- **Service**: `src/services/customerTrackingService.js` (`getCompletedHistory`, `getCompletedJobDetail`, `formatCompletedJobSummary`, `serializeCustomerEstimate`)
- **Controller**: `src/controllers/customerJobController.js` (`getCompletedHistory`, `getCompletedJobDetail`)
- **Routes**:
  - `src/routes/customerRoutes.js` (`GET /api/customer/jobs/history`, `GET /api/customer/jobs/:jobIdentifier/history`)
  - `src/routes/jobRoutes.js` (`GET /api/jobs/:jobIdentifier/completed`)
- **Automated Tests**: `scripts/testCustomerCompletedHistory.js`
- **NPM Script**: `npm run history:test`

---

## Postman Collection Integration
Postman folder: **Folder 22 — Customer - Completed Repair Records & History (SCRUM-125)**
- `GET {{baseUrl}}/api/customer/jobs/history` (List completed jobs)
- `GET {{baseUrl}}/api/customer/jobs/{{repairJobReference}}/history` (Job detail by reference)
- `GET {{baseUrl}}/api/jobs/{{repairJobId}}/completed` (Jira alias route)
- `GET {{baseUrl}}/api/customer/jobs/OTHER_CUSTOMER_REF/history` (IDOR defense 404 test)
- `GET {{baseUrl}}/api/customer/jobs/IN_PROGRESS_REF/history` (Non-collected job refusal 400 test)
