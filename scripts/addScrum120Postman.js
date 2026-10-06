const fs = require('fs');

const collectionPath = 'RepairFlow Backend.postman_collection.json';
const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

// Remove existing SCRUM-120 folder if present to allow clean re-runs
collection.item = collection.item.filter(
  (folder) => !folder.name.includes('SCRUM-120') && !folder.name.includes('Device Handover')
);

const newFolder = {
  name: 'Staff - Customer Device Handover (SCRUM-120)',
  item: [
    {
      name: 'Staff Record Device Handover - Repaired (Ready for Collection -> Collected)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Success is true', () => pm.expect(data.success).to.be.true);",
              "pm.test('Job status is Collected', () => pm.expect(data.job.status).to.eql('Collected'));",
              "pm.test('Outcome is repaired', () => pm.expect(data.job.collectionDetails.outcome).to.eql('repaired'));",
              "pm.test('Collected timestamp is recorded', () => pm.expect(data.job.collectionDetails.collectedAt).to.be.a('string'));",
              "pm.test('Staff member ID is stored', () => pm.expect(data.job.collectionDetails.collectedBy).to.not.be.null);",
              "pm.test('Audit update event created with toStatus Collected', () => {",
              "  pm.expect(data.update).to.be.an('object');",
              "  pm.expect(data.update.toStatus).to.eql('Collected');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: true,
              notes: 'Customer presented photo ID and collected repaired device.'
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'SCRUM-120: Owner/Staff records handing a repaired device back to the customer. Status moves to Collected with collection timestamp, staff member ID, customer verification flags, and outcome: repaired.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Unrepaired (Ready for Return -> Collected)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Success is true', () => pm.expect(data.success).to.be.true);",
              "pm.test('Job status is Collected', () => pm.expect(data.job.status).to.eql('Collected'));",
              "pm.test('Outcome is unrepaired', () => pm.expect(data.job.collectionDetails.outcome).to.eql('unrepaired'));",
              "pm.test('Collected timestamp is recorded', () => pm.expect(data.job.collectionDetails.collectedAt).to.be.a('string'));"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: true,
              notes: 'Device returned unrepaired following customer request.'
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'SCRUM-120: Owner/Staff records customer handover for a job that was Ready for Return. Sets outcome to unrepaired and status to Collected.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Idempotent Replay (Already Collected)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Already collected flag is true', () => pm.expect(data.alreadyCollected).to.be.true);",
              "pm.test('Returns existing Collected job without duplicate event', () => {",
              "  pm.expect(data.job.status).to.eql('Collected');",
              "  pm.expect(data.update).to.be.null;",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: true
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'SCRUM-120: Repeating the same successful handover request on an already Collected job safely returns the existing state without creating another collection event.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Jira Alias Route (/api/jobs/:id/handover)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Jira alias successfully records or replays handover', () => {",
              "  pm.expect(data.job.status).to.eql('Collected');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: true
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'Jira-compatible route alias for customer device handover.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Refuse Missing Identity Confirmation (422)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 422', () => pm.response.to.have.status(422));",
              "const data = pm.response.json();",
              "pm.test('Validation error returned for unconfirmed identity', () => {",
              "  pm.expect(data.error.message).to.include('identity');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: false,
              deviceHandedOver: true
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'Verifies that handover cannot proceed without explicit confirmation of the customer identity.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Refuse Missing Device Handover Confirmation (422)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 422', () => pm.response.to.have.status(422));",
              "const data = pm.response.json();",
              "pm.test('Validation error returned for unconfirmed device handover', () => {",
              "  pm.expect(data.error.message).to.include('handed over');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: false
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'Verifies that handover cannot proceed without explicit confirmation that device was handed over.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Refuse Non-Ready Job Status (409 Conflict)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 409', () => pm.response.to.have.status(409));",
              "const data = pm.response.json();",
              "pm.test('State conflict returned for non-ready job', () => {",
              "  pm.expect(data.error.codeName).to.eql('INVALID_STATUS');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: true
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'Verifies that handover is refused when the job is not in Ready for Collection or Ready for Return.'
      },
      response: []
    },
    {
      name: 'Staff Record Device Handover - Forbidden for Unauthorized Role (403)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 403', () => pm.response.to.have.status(403));"
            ]
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              customerIdentityConfirmed: true,
              deviceHandedOver: true
            },
            null,
            2
          )
        },
        url: {
          raw: '{{baseUrl}}/api/staff/jobs/{{activeJobId}}/handover',
          host: ['{{baseUrl}}'],
          path: ['api', 'staff', 'jobs', '{{activeJobId}}', 'handover']
        },
        description: 'Verifies that customers and technicians cannot perform staff handover.'
      },
      response: []
    }
  ],
  description: 'SCRUM-120: Owner/Staff records handing a ready device back to its customer. Status becomes Collected with staff member and collection time, outcome (Repaired or Unrepaired), and immutable read-only lock.'
};

collection.item.push(newFolder);
fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
console.log('Successfully added SCRUM-120 folder to RepairFlow Backend.postman_collection.json');
