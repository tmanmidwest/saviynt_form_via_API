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
}

module.exports = { MockSaviyntClient };
