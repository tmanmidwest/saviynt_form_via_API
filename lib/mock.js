// Stand-in for SaviyntClient so the form can be developed and demoed offline.
// Shapes match the examples in the Saviynt v24.2 Postman collection.

const ORGS = [
  { organizationname: 'Acme Logistics', description: 'Freight and shipping partner', organizationtype: 'Grouping', status: 'Active', location: 'Chicago', parentorganization: 'External Partners' },
  { organizationname: 'Blue Harbor Consulting', description: 'Implementation consultants', organizationtype: 'Grouping', status: 'Active', location: 'Boston', parentorganization: 'External Partners' },
  { organizationname: 'Northwind Suppliers', description: 'Raw materials vendor', organizationtype: 'Grouping', status: 'Active', location: 'Denver', parentorganization: 'Vendors' },
  { organizationname: 'Summit Health Clinics', description: 'Customer organization', organizationtype: 'Grouping', status: 'Active', location: 'Minneapolis', parentorganization: 'Customers' },
];

class MockSaviyntClient {
  async ping() {
    return true;
  }

  async getOrganizations() {
    return ORGS;
  }

  async createUserRequest(user) {
    // Mirror the collection's success shape with a fake request id.
    console.log('[mock] createUserRequest:', user);
    return { msg: 'Success', errorCode: '0', requestid: String(Math.floor(100000 + Math.random() * 900000)) };
  }

  async fetchRequestHistory(body) {
    return {
      msg: 'Successful',
      errorCode: '0',
      totalcount: 1,
      count: 1,
      requests: [
        {
          requestid: String(body.requestid || '123456'),
          requesttype: 'Create User',
          requestor: 'Portal Service (svc_portal)',
          requestedfor: 'New External User',
          requestsubmittedon: '2026-10-26 18:40:00',
          status: 'Pending Approval',
          assignee: 'acook',
          requestandtaskstatus: 'Request pending, awaiting manager approval',
        },
      ],
    };
  }
}

module.exports = { MockSaviyntClient };
