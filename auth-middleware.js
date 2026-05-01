// auth-middleware.js
const fs = require('fs');
const path = require('path');

// Load customer token mappings
function loadCustomerMappings() {
  try {
    const filePath = path.join(__dirname, 'customer-tokens.json');
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading customer tokens:', error);
    return { customers: [] };
  }
}

// Middleware to authenticate and attach Profile ID
function authenticateCustomer(req, res, next) {
  // Get bearer token from header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Missing or invalid Authorization header. Expected: Bearer <token>' 
    });
  }

  // Extract token
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Load mappings and find customer
  const mappings = loadCustomerMappings();
  const customer = mappings.customers.find(
    c => c.bearerToken === token && c.active === true
  );

  if (!customer) {
    return res.status(403).json({ 
      error: 'Invalid or inactive bearer token' 
    });
  }

  // Attach customer info to request for use in route handlers
  req.customer = {
    name: customer.name,
    profileId: customer.profileId,
    ratingOptionId: customer.ratingOptionId,
    bearerToken: token
  };

  console.log(`Authenticated request for: ${customer.name} (Profile ID: ${customer.profileId})`);
  next();
}

module.exports = { authenticateCustomer };