// Stand-in for SaviyntClient so the form can be developed and demoed offline.
// Shapes match the examples in the Saviynt v24.2 Postman collection.

const log = require('./log');

const ORGS = [
  { organizationname: 'Acme Logistics', description: 'Freight and shipping partner', organizationtype: 'Grouping', status: 'Active', location: 'Chicago', parentorganization: 'External Partners' },
  { organizationname: 'Blue Harbor Consulting', description: 'Implementation consultants', organizationtype: 'Grouping', status: 'Active', location: 'Boston', parentorganization: 'External Partners' },
  { organizationname: 'Northwind Suppliers', description: 'Raw materials vendor', organizationtype: 'Grouping', status: 'Active', location: 'Denver', parentorganization: 'Vendors' },
  { organizationname: 'Summit Health Clinics', description: 'Customer organization', organizationtype: 'Grouping', status: 'Active', location: 'Minneapolis', parentorganization: 'Customers' },
];

// Sample users for the manager lookup, tagged with the org (customer) they
// belong to so org-scoped lookups have something to filter on.
const USERS = [
  { firstname: 'Janet', lastname: 'Cole', username: 'jcole', email: 'janet.cole@acme.com', title: 'Operations Manager', customer: 'Acme Logistics' },
  { firstname: 'Marcus', lastname: 'Reed', username: 'mreed', email: 'marcus.reed@acme.com', title: 'Fleet Supervisor', customer: 'Acme Logistics' },
  { firstname: 'Priya', lastname: 'Nair', username: 'pnair', email: 'priya.nair@blueharbor.com', title: 'Engagement Lead', customer: 'Blue Harbor Consulting' },
  { firstname: 'Tom', lastname: 'Becker', username: 'tbecker', email: 'tom.becker@northwind.com', title: 'Supply Manager', customer: 'Northwind Suppliers' },
  { firstname: 'Dana', lastname: 'Fuller', username: 'dfuller', email: 'dana.fuller@summithealth.com', title: 'Clinic Director', customer: 'Summit Health Clinics' },
];

class MockSaviyntClient {
  async ping() {
    return true;
  }

  async getOrganizations() {
    return ORGS;
  }

  async searchUsers(query) {
    // Ignore the Saviynt query syntax; the server does the real filtering.
    log.debug('mock.searchUsers', { query });
    return USERS.map((u) => ({ ...u, 'User Name': u.username, 'Last Name': u.lastname }));
  }

  async createUserRequest(user, { reqId } = {}) {
    // Mirror the collection's success shape with a fake request id. Full user
    // (which includes PII like email) only at debug level.
    log.debug('mock.createUserRequest', { reqId, user });
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
