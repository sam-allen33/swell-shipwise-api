const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

const AUDIT_LOG_ENABLED = String(process.env.AUDIT_LOG_ENABLED || 'false').toLowerCase() === 'true';
const AUDIT_DB_PATH = process.env.AUDIT_DB_PATH || '/home/data/audit.db';

let auditDb;

function initializeAuditLogging() {
  if (!AUDIT_LOG_ENABLED) {
    console.log('[AUDIT] Audit logging is disabled (AUDIT_LOG_ENABLED=false)');
    return;
  }

  try {
    const dbDir = path.dirname(AUDIT_DB_PATH);
    fs.mkdirSync(dbDir, { recursive: true });

    auditDb = new sqlite3.Database(AUDIT_DB_PATH, (err) => {
      if (err) {
        console.error(`[AUDIT] Failed to open sqlite database at ${AUDIT_DB_PATH}:`, err.message);
        return;
      }

      auditDb.run(
        `CREATE TABLE IF NOT EXISTS shipping_rate_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requestId TEXT,
          customerName TEXT,
          profileId INTEGER,
          tokenHash TEXT,
          destinationCountry TEXT,
          itemCount INTEGER,
          statusCode INTEGER,
          success INTEGER,
          errorMessage TEXT,
          createdAt TEXT NOT NULL
        )`,
        (createErr) => {
          if (createErr) {
            console.error('[AUDIT] Failed creating shipping_rate_audit table:', createErr.message);
          } else {
            console.log(`[AUDIT] sqlite enabled. Table shipping_rate_audit ready at ${AUDIT_DB_PATH}`);
          }
        }
      );
    });
  } catch (error) {
    console.error('[AUDIT] Failed to initialize audit logging:', error.message);
  }
}

function createAuditContext(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  return {
    requestId: crypto.randomUUID(),
    tokenHash: token
      ? crypto.createHash('sha256').update(token).digest('hex')
      : null
  };
}

function writeAuditLog(entry) {
  if (!AUDIT_LOG_ENABLED || !auditDb) {
    return;
  }

  const statement = `
    INSERT INTO shipping_rate_audit (
      requestId,
      customerName,
      profileId,
      tokenHash,
      destinationCountry,
      itemCount,
      statusCode,
      success,
      errorMessage,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    entry.requestId,
    entry.customerName,
    entry.profileId,
    entry.tokenHash,
    entry.destinationCountry,
    entry.itemCount,
    entry.statusCode,
    entry.success ? 1 : 0,
    entry.errorMessage,
    new Date().toISOString()
  ];

  auditDb.run(statement, params, (err) => {
    if (err) {
      console.error('[AUDIT] Failed to write audit log:', err.message);
    }
  });
}

// Middleware
app.use(cors());
app.use(express.json());

// Load customer token mappings from JSON file
function loadCustomerMappings() {
  try {
    const filePath = path.join(__dirname, 'customer-tokens.json');
    const data = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(data);
    console.log(`✅ Loaded ${parsed.customers.length} customer profiles`);
    return parsed;
  } catch (error) {
    console.error('❌ Error loading customer-tokens.json:', error.message);
    console.error('Make sure customer-tokens.json exists in the same folder as server.js');
    return { customers: [] };
  }
}

// Authentication middleware
function authenticateCustomer(req, res, next) {
  // Get bearer token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      message: 'Expected format: Authorization: Bearer <your-token>'
    });
  }

  // Extract token (remove 'Bearer ' prefix)
  const token = authHeader.substring(7);

  // Load customer mappings and find matching customer
  const mappings = loadCustomerMappings();
  const customer = mappings.customers.find(
    (c) => c.bearerToken === token && c.active === true
  );

  if (!customer) {
    return res.status(403).json({
      error: 'Invalid or inactive bearer token',
      message: 'The provided token is not recognized or has been deactivated'
    });
  }

  // Attach customer info to request for use in route handlers
  req.customer = {
    name: customer.name,
    profileId: customer.profileId
  };

  console.log(`🔑 Authenticated: ${customer.name} (Profile ID: ${customer.profileId})`);
  next();
}

// Health check endpoint (no authentication required)
app.get('/', (req, res) => {
  const mappings = loadCustomerMappings();
  const activeCustomers = mappings.customers.filter((c) => c.active).length;

  res.json({
    status: 'API is running',
    version: '2.0',
    activeCustomers: activeCustomers,
    endpoints: {
      health: 'GET /',
      getShippingRates: 'POST /api/shipping-rates (requires Bearer token)'
    },
    authentication: 'Bearer token required in Authorization header'
  });
});

// Main endpoint to get shipping rates (with authentication)
app.post('/api/shipping-rates', authenticateCustomer, async (req, res) => {
  const auditContext = createAuditContext(req);

  try {
    console.log('\n📦 New shipping rate request');
    console.log('Customer:', req.customer.name);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const {
      items,
      destination,
    } = req.body;

    // Validate required fields
    if (!items || !destination) {
      const responseBody = {
        error: 'Missing required fields',
        required: ['items', 'destination'],
        received: {
          items: !!items,
          destination: !!destination
        }
      };

      writeAuditLog({
        requestId: auditContext.requestId,
        customerName: req.customer.name,
        profileId: parseInt(req.customer.profileId, 10),
        tokenHash: auditContext.tokenHash,
        destinationCountry: destination?.country || null,
        itemCount: Array.isArray(items) ? items.length : 0,
        statusCode: 400,
        success: false,
        errorMessage: responseBody.error
      });

      return res.status(400).json(responseBody);
    }

    // Prepare the Shipwise Rate request using authenticated customer's profile
    const shipwiseRequest = {
      profileId: parseInt(req.customer.profileId, 10),
      ratingOptionId: 'STANDARD',
      addressVerification: false,
      dateAdvanceDays: 0,

      to: {
        id: 0,
        name: destination.name || 'Customer',
        company: destination.company || '',
        address1: destination.address1 || '',
        address2: destination.address2 || '',
        city: destination.city || '',
        state: destination.state || '',
        postalCode: destination.zip || destination.postalCode || '',
        countryCode: destination.country || 'US',
        phone: destination.phone || '',
        email: destination.email || '',
        avsInfo: {
          validationState: 1,
          isResidential: true
        }
      },

      packages: items.map((item, index) => {
        const totalWeight = (item.weight || 1) * (item.quantity || 1);

        return {
          packageId: `package_${index + 1}`,
          totalWeight: totalWeight,
          packaging: {
            height: String(item.height || 10),
            length: String(item.length || 10),
            width: String(item.width || 10)
          },
          serviceFlags: ['BPM']
        };
      })
    };

    console.log('📤 Sending to Shipwise API...');
    console.log('Profile ID:', req.customer.profileId);

    // Call Shipwise API using the Shipwise API bearer token from environment
    const shipwiseBearerToken = process.env.SHIPWISE_BEARER_TOKEN || process.env.BEARER_TOKEN;

    if (!shipwiseBearerToken) {
      console.error('❌ Missing SHIPWISE_BEARER_TOKEN in .env file');

      writeAuditLog({
        requestId: auditContext.requestId,
        customerName: req.customer.name,
        profileId: parseInt(req.customer.profileId, 10),
        tokenHash: auditContext.tokenHash,
        destinationCountry: destination.country || null,
        itemCount: items.length,
        statusCode: 500,
        success: false,
        errorMessage: 'Shipwise API token not configured'
      });

      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Shipwise API token not configured'
      });
    }

    console.log(
      `[SHIPWISE_CALL] time=${new Date().toISOString()} profileId=${req.customer?.profileId}`
    );

    const shipwiseResponse = await axios.post(
      'https://api.shipwise.com/api/v1/Rate',
      shipwiseRequest,
      {
        headers: {
          Authorization: `Bearer ${shipwiseBearerToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Shipwise response received');

    // Check if Shipwise request was successful
    if (!shipwiseResponse.data.wasSuccessful) {
      console.error('❌ Shipwise returned unsuccessful:', shipwiseResponse.data.responseMsg);

      writeAuditLog({
        requestId: auditContext.requestId,
        customerName: req.customer.name,
        profileId: parseInt(req.customer.profileId, 10),
        tokenHash: auditContext.tokenHash,
        destinationCountry: destination.country || null,
        itemCount: items.length,
        statusCode: 500,
        success: false,
        errorMessage: shipwiseResponse.data.responseMsg || 'Failed to get rates from Shipwise'
      });

      return res.status(500).json({
        error: 'Failed to get rates from Shipwise',
        message: shipwiseResponse.data.responseMsg,
        details: shipwiseResponse.data
      });
    }

    // Extract and format rates from Shipwise response
    const rates = [];

    if (shipwiseResponse.data.shipmentItems && shipwiseResponse.data.shipmentItems.length > 0) {
      const packageItem = shipwiseResponse.data.shipmentItems[0];

      // Add selected rate if exists
      if (packageItem.selectedRate) {
        const rate = packageItem.selectedRate;
        rates.push({
          id: rate.carrierService || rate.carrierCode,
          name: `${rate.carrier} ${rate.class}`.trim(),
          carrier: rate.carrier,
          service: rate.class,
          price: parseFloat(rate.value || rate.baseCharge || 0),
          delivery_days: rate.transitTime?.estimatedDeliveryDays
            || rate.estimatedDeliveryDays
            || null,
          estimated_delivery: rate.transitTime?.estimatedDelivery
            || rate.estimatedDelivery
            || null
        });
      }

      // Add all available rates
      if (packageItem.rates && Array.isArray(packageItem.rates)) {
        packageItem.rates.forEach((rate) => {
          rates.push({
            id: rate.carrierService || rate.carrierCode,
            name: `${rate.carrier} ${rate.class}`.trim(),
            carrier: rate.carrier,
            service: rate.class,
            price: parseFloat(rate.value || rate.baseCharge || 0),
            delivery_days: rate.transitTime?.estimatedDeliveryDays
              || rate.estimatedDeliveryDays
              || null,
            estimated_delivery: rate.transitTime?.estimatedDelivery
              || rate.estimatedDelivery
              || null
          });
        });
      }
    }

    // Remove duplicate rates (same ID)
    const uniqueRates = rates.reduce((acc, rate) => {
      if (!acc.find((r) => r.id === rate.id)) {
        acc.push(rate);
      }
      return acc;
    }, []);

    console.log(`✅ Returning ${uniqueRates.length} unique rate(s)`);
    console.log('Rates:', JSON.stringify(uniqueRates, null, 2));

    writeAuditLog({
      requestId: auditContext.requestId,
      customerName: req.customer.name,
      profileId: parseInt(req.customer.profileId, 10),
      tokenHash: auditContext.tokenHash,
      destinationCountry: destination.country || null,
      itemCount: items.length,
      statusCode: 200,
      success: true,
      errorMessage: null
    });

    return res.json({
      success: true,
      customer: req.customer.name,
      profileId: req.customer.profileId,
      rates: uniqueRates
    });
  } catch (error) {
    console.error('❌ Error getting shipping rates:');
    console.error('Error message:', error.message);

    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));

      writeAuditLog({
        requestId: auditContext.requestId,
        customerName: req.customer?.name || null,
        profileId: req.customer?.profileId ? parseInt(req.customer.profileId, 10) : null,
        tokenHash: auditContext.tokenHash,
        destinationCountry: req.body?.destination?.country || null,
        itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
        statusCode: error.response.status,
        success: false,
        errorMessage: error.message
      });

      return res.status(error.response.status).json({
        error: 'Failed to get shipping rates from Shipwise',
        details: error.response.data,
        message: error.message
      });
    }

    writeAuditLog({
      requestId: auditContext.requestId,
      customerName: req.customer?.name || null,
      profileId: req.customer?.profileId ? parseInt(req.customer.profileId, 10) : null,
      tokenHash: auditContext.tokenHash,
      destinationCountry: req.body?.destination?.country || null,
      itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
      statusCode: 500,
      success: false,
      errorMessage: error.message
    });

    return res.status(500).json({
      error: 'Failed to get shipping rates',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  initializeAuditLogging();

  console.log(`\n${'='.repeat(50)}`);
  console.log('🚀 Shipping Rate API Server');
  console.log('='.repeat(50));
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log('📦 Endpoint: POST /api/shipping-rates');

  const mappings = loadCustomerMappings();
  const activeCustomers = mappings.customers.filter((c) => c.active).length;
  console.log(`🔑 Active customers: ${activeCustomers}`);

  console.log('\n📝 Authentication:');
  console.log('   Header: Authorization: Bearer <your-token>');
  console.log(`\n🧾 Audit: enabled=${AUDIT_LOG_ENABLED} path=${AUDIT_DB_PATH}`);
  console.log(`\n${'='.repeat(50)}\n`);
});
