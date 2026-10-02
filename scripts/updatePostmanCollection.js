const fs = require('fs');

const collectionPath = 'RepairFlow Backend.postman_collection.json';
const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

const newFolder = {
  name: 'Customer - Public Repair Tracking (SCRUM-109)',
  item: [
    {
      name: 'Customer Track Repair Job - Current Status & Chronological Public Timeline',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Job details are present', () => {",
              "  pm.expect(data.job).to.be.an('object');",
              "  pm.expect(data.job.reference).to.be.a('string');",
              "  pm.expect(data.job.makeModel).to.be.a('string');",
              "  pm.expect(data.currentStatus).to.be.a('string');",
              "});",
              "pm.test('Public timeline events are dated and chronological', () => {",
              "  pm.expect(data.publicEvents).to.be.an('array');",
              "  for (let i = 0; i < data.publicEvents.length - 1; i++) {",
              "    const t1 = new Date(data.publicEvents[i].timestamp).getTime();",
              "    const t2 = new Date(data.publicEvents[i + 1].timestamp).getTime();",
              "    pm.expect(t1).to.be.at.most(t2);",
              "  }",
              "});",
              "pm.test('Sanitized of internal notes and technician IDs', () => {",
              "  const body = pm.response.text();",
              "  pm.expect(body).to.not.include('internalNotes');",
              "  pm.expect(body).to.not.include('internalNote');",
              "  pm.expect(body).to.not.include('assignedTechnician');",
              "  pm.expect(body).to.not.include('recordedBy');",
              "  pm.expect(body).to.not.include('startedBy');",
              "  pm.expect(body).to.not.include('updatedBy');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/{{activeJobId}}/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '{{activeJobId}}', 'track']
        },
        description: 'SCRUM-109: Customer tracks the latest saved status and chronological dated public events for their repair job. Response is completely sanitized of internal notes and technician IDs.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - Alias Route (/api/customer/jobs/:id/tracking)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Returns tracking DTO with status and events', () => {",
              "  pm.expect(data.currentStatus).to.be.a('string');",
              "  pm.expect(data.publicEvents).to.be.an('array');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/{{activeJobId}}/tracking',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '{{activeJobId}}', 'tracking']
        },
        description: 'Alias route for /api/customer/jobs/:id/track.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - Jira Alias Route (/api/jobs/:id/track)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "pm.test('Jira alias returns identical tracking DTO', () => {",
              "  pm.expect(data.job.reference).to.be.a('string');",
              "  pm.expect(data.publicEvents).to.be.an('array');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/jobs/{{activeJobId}}/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'jobs', '{{activeJobId}}', 'track']
        },
        description: 'Jira-compatible endpoint alias for public-safe tracking.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - Awaiting Approval Links to Decision',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "if (data.currentStatus === 'Awaiting Approval') {",
              "  pm.test('Action is required from customer', () => {",
              "    pm.expect(data.actionRequired).to.eql(true);",
              "    pm.expect(data.actionType).to.eql('ESTIMATE_DECISION');",
              "  });",
              "  pm.test('Contains estimate decision link', () => {",
              "    pm.expect(data.estimateDecision).to.be.an('object');",
              "    pm.expect(data.estimateDecision.decisionUrl).to.include('/estimate-decision');",
              "    pm.expect(data.estimateDecision.viewEstimateUrl).to.include('/current-estimate');",
              "  });",
              "} else {",
              "  pm.test('Job not in Awaiting Approval; actionRequired is false', () => {",
              "    pm.expect(data.actionRequired).to.eql(false);",
              "  });",
              "}"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/{{activeJobId}}/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '{{activeJobId}}', 'track']
        },
        description: 'Verifies that an Awaiting Approval job displays actionRequired: true and links directly to its current estimate decision URL and view estimate URL.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - Waiting for Parts Public Delay Reason',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "if (data.currentStatus === 'Waiting for Parts' || (data.partsDelay && data.partsDelay.reason)) {",
              "  pm.test('Public delay reason is present', () => {",
              "    pm.expect(data.publicDelayReason).to.be.a('string');",
              "    pm.expect(data.partsDelay).to.be.an('object');",
              "  });",
              "}",
              "pm.test('No internal supplier note or technician ID leaked in delay info', () => {",
              "  const body = pm.response.text();",
              "  pm.expect(body).to.not.include('internalNote');",
              "  pm.expect(body).to.not.include('placedBy');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/{{activeJobId}}/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '{{activeJobId}}', 'track']
        },
        description: 'Verifies that Waiting for Parts displays the customer-safe public delay reason without internal notes or actor IDs.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - Handover Instruction for Collection or Return',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "if (data.currentStatus === 'Ready for Collection') {",
              "  pm.test('Displays collection handover instruction', () => {",
              "    pm.expect(data.handoverInstruction).to.be.a('string');",
              "    pm.expect(data.handoverInstruction.toLowerCase()).to.include('collection');",
              "  });",
              "} else if (data.currentStatus === 'Ready for Return') {",
              "  pm.test('Displays return unrepaired handover instruction', () => {",
              "    pm.expect(data.handoverInstruction).to.be.a('string');",
              "    pm.expect(data.handoverInstruction.toLowerCase()).to.include('return');",
              "  });",
              "}"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/{{activeJobId}}/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '{{activeJobId}}', 'track']
        },
        description: 'Verifies appropriate handover instruction is rendered when the device is Ready for Collection or Ready for Return.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - Collected State (Outcome & Collection Time)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "const data = pm.response.json();",
              "if (data.currentStatus === 'Collected') {",
              "  pm.test('Collected details are present', () => {",
              "    pm.expect(data.collection).to.be.an('object');",
              "    pm.expect(data.collection.collectedAt).to.be.a('string');",
              "    pm.expect(['repaired', 'unrepaired']).to.include(data.collection.outcome);",
              "  });",
              "}"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/{{activeJobId}}/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '{{activeJobId}}', 'track']
        },
        description: 'Verifies that Collected state displays the recorded collection time and repaired/unrepaired outcome.'
      },
      response: []
    },
    {
      name: 'Customer Track Repair Job - 404 for Other Customer Job (IDOR Protection)',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status is 404 Not Found', () => pm.response.to.have.status(404));",
              "const data = pm.response.json();",
              "pm.test('Message is Repair job not found', () => {",
              "  pm.expect(data.message).to.eql('Repair job not found');",
              "});"
            ]
          }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/customer/jobs/670000000000000000000000/track',
          host: ['{{baseUrl}}'],
          path: ['api', 'customer', 'jobs', '670000000000000000000000', 'track']
        },
        description: 'Verifies that requesting a job ID belonging to another customer returns 404 NOT_FOUND, preventing IDOR data disclosure.'
      },
      response: []
    }
  ],
  description: 'SCRUM-109: Customer public tracking view sanitized of internal notes and technician IDs. Features latest status, chronological dated public events, estimate decision links, delay reasons, handover instructions, and collection outcomes.'
};

// Check if folder already exists
const existingIndex = collection.item.findIndex((f) => f.name.includes('SCRUM-109'));
if (existingIndex >= 0) {
  collection.item[existingIndex] = newFolder;
  console.log('Updated existing SCRUM-109 folder in collection.');
} else {
  collection.item.push(newFolder);
  console.log('Appended new SCRUM-109 folder to collection.');
}

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log('RepairFlow Backend.postman_collection.json updated successfully.');
