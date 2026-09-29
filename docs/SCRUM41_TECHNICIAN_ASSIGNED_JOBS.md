# SCRUM-41 — Technician Assigned Repair Jobs View

## User Story & Acceptance Criteria

**User Story:**
> As a technician, I want to view and open my assigned repair jobs so that I can identify the devices that require my attention.

**Acceptance Criteria:**
- **Given** a technician is logged in,  
  **When** the technician opens the assigned job list,  
  **Then** only jobs assigned to that technician are displayed,  
  **And** each job shows its reference, device, reported fault and current status,  
  **And** selecting a job opens its permitted technical details,  
  **And** a technician with no assigned jobs sees an informative empty state.
- **Given** the technician changes a job identifier to one assigned to someone else,  
  **When** the job is requested directly,  
  **Then** access is denied without returning that job's details.

---

## Architecture & Code Additions

This feature was implemented cleanly into the layered architecture without affecting existing Customer or Staff workflows:

| Layer | File | Responsibilities Added |
| :--- | :--- | :--- |
| **Model** | `src/models/RepairJob.js` | Added `assignedTechnician` field (`ObjectId` ref to `User`), indexed with `{ assignedTechnician: 1, receivedAt: -1 }`. |
| **Repository** | `src/repositories/repairJobRepository.js` | Added `findAssignedToTechnician(technicianId)` querying only active jobs belonging to that technician, sorted newest first. |
| **Service** | `src/services/repairJobService.js` | Added `listAssignedJobs(technicianId)` with `serializeJobListItem` DTO and `getAssignedJobDetail(jobIdentifier, technicianId)` with strict 403 ownership enforcement. |
| **Controller** | `src/controllers/repairJobController.js` | Added `listMyJobs` and `getMyJob` HTTP handlers. |
| **Routes** | `src/routes/technicianRoutes.js` | Mounted protected routes under `/api/technician/jobs`. |

---

## Production Endpoints

### 1. List Assigned Repair Jobs
`GET /api/technician/jobs`

- **Role Required**: `technician` (Bearer token in `Authorization` header)
- **Description**: Returns all repair jobs assigned to the authenticated technician.
- **Empty State Response (HTTP 200)**:
  ```json
  {
    "count": 0,
    "jobs": []
  }
  ```
- **Populated Response (HTTP 200)**:
  ```json
  {
    "count": 1,
    "jobs": [
      {
        "id": "67e2a1b4c890123456789abc",
        "reference": "JOB-202609-0001",
        "deviceType": "Smartphone",
        "makeModel": "Samsung Galaxy S22",
        "reportedFault": "Screen flickering and touch unresponsive",
        "status": "Received",
        "receivedAt": "2026-09-23T15:20:00.000Z"
      }
    ]
  }
  ```

---

### 2. Get Assigned Job Technical Details
`GET /api/technician/jobs/:jobIdentifier`

- **Role Required**: `technician` (Bearer token in `Authorization` header)
- **Path Parameter**: `:jobIdentifier` accepts either the MongoDB `_id` OR the human reference (`JOB-YYYYMM-XXXX`).
- **Description**: Returns full technical specifications, reported fault, intake timestamp, and customer contact details.
- **Success Response (HTTP 200)**:
  ```json
  {
    "job": {
      "id": "67e2a1b4c890123456789abc",
      "reference": "JOB-202609-0001",
      "customer": {
        "id": "67e2a001c890123456789aaa",
        "fullName": "Kasun Perera",
        "email": "kasun@example.com",
        "contactNumber": "+94771234567"
      },
      "deviceType": "Smartphone",
      "makeModel": "Samsung Galaxy S22",
      "serialNumber": "SN-12345678",
      "reportedFault": "Screen flickering and touch unresponsive",
      "status": "Received",
      "receivedAt": "2026-09-23T15:20:00.000Z",
      "createdBy": "67e29999c890123456789000",
      "createdAt": "2026-09-23T15:20:00.000Z",
      "updatedAt": "2026-09-23T15:20:00.000Z"
    }
  }
  ```

---

## Security & Access Control Enforcement

1. **Role Verification**:
   - Both endpoints are guarded by `protect` and `authorizeRoles('technician')`.
   - Access by `customer` or unauthenticated requests returns `401 Unauthorized` or `403 Forbidden`.

2. **Zero Information Leakage (403 on Unassigned / Other Tech Jobs)**:
   - When a technician attempts to access a job assigned to another technician or a job not yet assigned, the service throws:
     ```json
     {
       "message": "You do not have permission to access this job"
     }
     ```
     with **HTTP 403 Forbidden**. No customer data or device specifications are leaked.

3. **Missing Jobs (404)**:
   - Requesting a non-existent job ID returns **HTTP 404 Not Found** (`{ "message": "Repair job not found" }`).

---

## Postman Collection Testing

The collection `RepairFlow Backend.postman_collection.json` has a dedicated folder:  
**`Technician - Assigned Jobs (SCRUM-41)`**

### Collection Variables Used:
- `baseUrl`: `http://localhost:5000`
- `technicianAccessToken`: Auth token from technician login
- `technicianJobReference`: e.g. `JOB-202609-0001`
- `technicianJobId`: e.g. `67e2a1b4c890123456789abc`

### Included Requests:
1. **List Assigned Jobs - Empty State**: Verifies HTTP 200 and `{ count: 0, jobs: [] }`.
2. **List Assigned Jobs - With Assigned Work**: Verifies HTTP 200 and assigned job items list.
3. **Get Assigned Job Detail - by Reference**: Verifies lookup via human-readable reference `JOB-YYYYMM-XXXX`.
4. **Get Assigned Job Detail - by Mongo ID**: Verifies lookup via standard 24-character hexadecimal MongoDB ObjectId.
5. **Get Job Detail - Access Denied (Other Tech / 403)**: Verifies that accessing another technician's job returns 403 without data leakage.
6. **List Assigned Jobs - Unauthenticated (401)**: Verifies token requirement.

---

## Frontend Integration Contract

For building the **Technician Dashboard** in the frontend:
1. **Assigned List**: Call `GET /api/technician/jobs` on mount.
2. **Status Badges**: Map `job.status` to UI badges (`Received`, `Diagnosing`, `Awaiting Approval`, `Approved`, `In Repair`, `Waiting for Parts`, `Ready for Collection`, `Ready for Return`, `Collected`).
3. **Empty State**: When `jobs.length === 0`, display an informative state: *"No repair jobs currently assigned to you."*
4. **Open Job Details**: On clicking a job card, fetch `GET /api/technician/jobs/${job.reference}` or `${job.id}` to open modal/drawer.
5. **403 Access Denied**: If a user navigates to an unauthorized URL directly, catch the 403 and display an access-denied banner.
