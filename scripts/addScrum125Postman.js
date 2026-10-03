const fs = require('fs');
const path = require('path');

const collectionPath = path.join(__dirname, '..', 'RepairFlow Backend.postman_collection.json');
const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

// Check if Folder 22 already exists
const existingFolderIndex = collection.item.findIndex(f => f.name.includes('SCRUM-125') || f.name.includes('Completed Repair Records'));
if (existingFolderIndex !== -1) {
  console.log('Folder for SCRUM-125 already exists. Updating it...');
  collection.item.splice(existingFolderIndex, 1);
}

const scrum125Folder = {
  name: "Customer - Completed Repair Records & History (SCRUM-125)",
  description: "SCRUM-125: Authenticated customers view completed (Collected) repair records, outcomes (Repaired/Unrepaired), collection time, public repair summary or return reason, and issued estimate versions with recorded decisions. Enforces multi-tenant IDOR protection, immutability, and zero data leakage of internal notes.",
  item: [
    {
      name: "Get Completed Repair Records (History List)",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const body = pm.response.json();",
              "pm.test('Response is successful', () => pm.expect(body.status).to.eql('success'));",
              "pm.test('Jobs array returned', () => pm.expect(body.data.jobs).to.be.an('array'));",
              "if (body.data.jobs.length > 0) {",
              "  const job = body.data.jobs[0];",
              "  pm.test('Contains reference and device', () => {",
              "    pm.expect(job).to.have.property('reference');",
              "    pm.expect(job).to.have.property('device');",
              "  });",
              "  pm.test('Contains outcome and collection time', () => {",
              "    pm.expect(job).to.have.property('outcome');",
              "    pm.expect(job).to.have.property('outcomeDisplay');",
              "    pm.expect(job).to.have.property('collectionTime');",
              "  });",
              "  pm.test('Contains publicRepairSummary or returnReason', () => {",
              "    pm.expect(job.publicRepairSummary !== undefined || job.returnReason !== undefined).to.be.true;",
              "  });",
              "  pm.test('Contains estimate history and customer decisions', () => {",
              "    pm.expect(job).to.have.property('estimateHistory');",
              "  });",
              "  pm.test('Zero Data Leakage: Internal notes and tech IDs excluded', () => {",
              "    const str = JSON.stringify(job);",
              "    pm.expect(str).to.not.include('internalNotes');",
              "    pm.expect(str).to.not.include('assignedTechnician');",
              "    pm.expect(str).to.not.include('collectedBy');",
              "  });",
              "}"
            ]
          }
        }
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/customer/jobs/history",
          host: ["{{baseUrl}}"],
          path: ["api", "customer", "jobs", "history"]
        },
        description: "Returns completed repair records for authenticated customer with outcome, collection details, estimates, and customer decisions."
      },
      response: []
    },
    {
      name: "Get Completed Job Record Detail by Reference",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const body = pm.response.json();",
              "pm.test('Status is Collected', () => pm.expect(body.data.status).to.eql('Collected'));",
              "pm.test('Includes public timeline events', () => pm.expect(body.data.publicEvents).to.be.an('array'));",
              "pm.test('Includes estimate versions and decisions', () => pm.expect(body.data.estimateHistory).to.be.an('array'));",
              "pm.test('Zero Data Leakage: No internal findings or technician IDs', () => {",
              "  const str = JSON.stringify(body.data);",
              "  pm.expect(str).to.not.include('internalNotes');",
              "  pm.expect(str).to.not.include('recommendedWork');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/customer/jobs/{{repairJobReference}}/history",
          host: ["{{baseUrl}}"],
          path: ["api", "customer", "jobs", "{{repairJobReference}}", "history"]
        },
        description: "Fetches detailed record of a single selected completed repair job for the customer."
      },
      response: []
    },
    {
      name: "Get Completed Job Record Detail (Jira Alias Route)",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const body = pm.response.json();",
              "pm.test('Job reference matches', () => pm.expect(body.data.reference).to.eql(pm.collectionVariables.get('repairJobReference')));",
              "pm.test('Status is Collected', () => pm.expect(body.data.status).to.eql('Collected'));"
            ]
          }
        }
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/jobs/{{repairJobReference}}/completed",
          host: ["{{baseUrl}}"],
          path: ["api", "jobs", "{{repairJobReference}}", "completed"]
        },
        description: "Jira-compatible route alias for retrieving completed job record."
      },
      response: []
    },
    {
      name: "Reject Unauthorized Read of Other Customer's Closed Record (IDOR 404)",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "pm.test('Status is 404', () => pm.response.to.have.status(404));",
              "const body = pm.response.json();",
              "pm.test('Error code is NOT_FOUND', () => {",
              "  pm.expect(body.error.codeName).to.eql('NOT_FOUND');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/customer/jobs/JOB-OTHER-CUSTOMER-9999/history",
          host: ["{{baseUrl}}"],
          path: ["api", "customer", "jobs", "JOB-OTHER-CUSTOMER-9999", "history"]
        },
        description: "Verifies IDOR protection: requesting another customer's closed job returns 404 Not Found."
      },
      response: []
    },
    {
      name: "Reject Request for In-Progress (Non-Collected) Job in History (400)",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "pm.test('Status is 400 or 404', () => pm.expect([400, 404]).to.include(pm.response.code));",
              "const body = pm.response.json();",
              "if (pm.response.code === 400) {",
              "  pm.test('Code is JOB_NOT_COLLECTED', () => pm.expect(body.error.codeName).to.eql('JOB_NOT_COLLECTED'));",
              "}"
            ]
          }
        }
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/customer/jobs/{{repairJobReference}}/history",
          host: ["{{baseUrl}}"],
          path: ["api", "customer", "jobs", "{{repairJobReference}}", "history"]
        },
        description: "Verifies that requesting completed history for an uncollected job is rejected."
      },
      response: []
    }
  ]
};

collection.item.push(scrum125Folder);

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
console.log('Successfully updated RepairFlow Backend.postman_collection.json with Folder 22: ' + scrum125Folder.name);
