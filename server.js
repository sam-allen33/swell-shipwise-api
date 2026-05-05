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
const SECRET_KEY_PATTERNS = ['token', 'authorization', 'secret', 'password', 'apiKey', 'apikey', 'bearer'];

let auditDb;

function isSecretKey(key) {
  const lowered = String(key || '').toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => lowered.includes(pattern.toLowerCase()));
}

function redactStringSecrets(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/bearer\s+[a-z0-9._\-~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(authorization\s*[:=]\s*)([^,\s]+)/gi, '$1[REDACTED]');
}

function sanitizeForAudit(input, keyHint = '') {
  if (input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForAudit(item));
  }

  if (typeof input === 'object') {
    const sanitized = {};
    Object.keys(input).forEach((key) => {
      if (isSecretKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeForAudit(input[key], key);
      }
    });
    return sanitized;
  }

  if (typeof input === 'string') {
    if (isSecretKey(keyHint)) {
      return '[REDACTED]';
    }
    return redactStringSecrets(input);
  }

  return input;
}

function safeJsonString(input) {
  try {
    if (input === undefined) {
      return null;
    }
    return JSON.stringify(sanitizeForAudit(input));
  } catch (error) {
    return JSON.stringify({ error: 'Failed to serialize JSON', message: error.message });
  }
}

function safeRawJsonString(rawBody) {
  if (!rawBody) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody);
    return JSON.stringify(sanitizeForAudit(parsed));
  } catch (error) {
    return JSON.stringify({ raw: redactStringSecrets(String(rawBody)) });
  }
}

function hashToken(token) {
  if (!token) {
    return null;
  }

  return crypto.createHash('sha256').update(token).digest('hex');
}

function getTokenPreview(token) {
  if (!token) {
    return null;
  }

  if (token.length <= 8) {
    return '*'.repeat(token.length);
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function initializeAuditLogging() {
  if (!AUDIT_LOG_ENABLED) {
    console.log('[AUDIT] Audit logging is disabled (AUDIT_LOG_ENABLED=false)');
    return;
  }

  try {
    const dbDir = path.dirname(AUDIT_DB_PATH);
    fs.mkdirSync(dbDir, { recursive: true });

    auditDb = new sqlite3.Database(AUDIT_DB_PATH, (openErr) => {
      if (openErr) {
        console.error(`[AUDIT] Failed to open sqlite database at ${AUDIT_DB_PATH}:`, openErr.message);
        return;
      }

      const createTableSql = `
        CREATE TABLE IF NOT EXISTS shipping_rate_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT,
          request_started_at TEXT,
          request_completed_at TEXT,
          duration_ms INTEGER,
          method TEXT,
          path TEXT,
          status_code INTEGER,
          customer_name TEXT,
          profile_id INTEGER,
          token_hash TEXT,
          token_preview TEXT,
          raw_request_json TEXT,
          parsed_request_json TEXT,
          shipwise_request_json TEXT,
          shipwise_response_json TEXT,
          shipwise_error_json TEXT,
          auth_metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `;

      auditDb.run(createTableSql, (createErr) => {
        if (createErr) {
          console.error('[AUDIT] Failed creating shipping_rate_audit table:', createErr.message);
        } else {
          console.log(`[AUDIT] sqlite enabled. Table shipping_rate_audit ready at ${AUDIT_DB_PATH}`);
        }
      });
    });
  } catch (error) {
    console.error('[AUDIT] Failed to initialize audit logging:', error.message);
  }
}

function writeAuditLog(record) {
  if (!AUDIT_LOG_ENABLED || !auditDb) {
    return;
  }

  const statement = `
    INSERT INTO shipping_rate_audit (
      request_id,
      request_started_at,
      request_completed_at,
      duration_ms,
      method,
      path,
      status_code,
      customer_name,
      profile_id,
      token_hash,
      token_preview,
      raw_request_json,
      parsed_request_json,
      shipwise_request_json,
      shipwise_response_json,
      shipwise_error_json,
      auth_metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    record.requestId,
    record.requestStartedAt,
    record.requestCompletedAt,
    record.durationMs,
    record.method,
    record.path,
    record.statusCode,
    record.customerName,
    record.profileId,
    record.tokenHash,
    record.tokenPreview,
    record.rawRequestJson,
    record.parsedRequestJson,
    record.shipwiseRequestJson,
    record.shipwiseResponseJson,
    record.shipwiseErrorJson,
    record.authMetadata
  ];

  auditDb.run(statement, params, (err) => {
    if (err) {
      console.error('[AUDIT] Failed to write audit log:', err.message);
    }
  });
}

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

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

function attachAuditContext(req, res, next) {
  if (req.method !== 'POST' || req.path !== '/api/shipping-rates') {
    return next();
  }

  const authHeader = req.headers.authorization || null;
  const bearerPrefix = 'Bearer ';
  const hasBearer = authHeader && authHeader.startsWith(bearerPrefix);
  const token = hasBearer ? authHeader.substring(bearerPrefix.length) : null;
  const startedAtMs = Date.now();

  req.audit = {
    requestId: crypto.randomUUID(),
    requestStartedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    method: req.method,
    path: req.originalUrl || req.path,
    tokenHash: hashToken(token),
    tokenPreview: getTokenPreview(token),
    customerName: null,
    profileId: null,
    rawRequestJson: safeRawJsonString(req.rawBody),
    parsedRequestJson: safeJsonString(req.body),
    shipwiseRequestJson: null,
    shipwiseResponseJson: null,
    shipwiseErrorJson: null,
    authMetadata: {
      state: 'pending',
      hasAuthorizationHeader: !!authHeader,
      bearerSchemeDetected: !!hasBearer
    },
    recorded: false
  };

  res.on('finish', () => {
    if (!req.audit || req.audit.recorded) {
      return;
    }

    req.audit.recorded = true;
    const completedAtMs = Date.now();
    const record = {
      requestId: req.audit.requestId,
      requestStartedAt: req.audit.requestStartedAt,
      requestCompletedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - req.audit.startedAtMs,
      method: req.audit.method,
      path: req.audit.path,
      statusCode: res.statusCode,
      customerName: req.audit.customerName,
      profileId: req.audit.profileId,
      tokenHash: req.audit.tokenHash,
      tokenPreview: req.audit.tokenPreview,
      rawRequestJson: req.audit.rawRequestJson,
      parsedRequestJson: req.audit.parsedRequestJson,
      shipwiseRequestJson: req.audit.shipwiseRequestJson,
      shipwiseResponseJson: req.audit.shipwiseResponseJson,
      shipwiseErrorJson: req.audit.shipwiseErrorJson,
      authMetadata: safeJsonString(req.audit.authMetadata)
    };

    setImmediate(() => writeAuditLog(record));
  });

  return next();
}

function authenticateCustomer(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    if (req.audit) {
      req.audit.authMetadata = {
        state: 'missing_header',
        detail: 'Authorization header was not provided'
      };
    }

    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      message: 'Expected format: Authorization: Bearer <your-token>'
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    if (req.audit) {
      req.audit.authMetadata = {
        state: 'malformed_bearer_header',
        detail: 'Authorization header did not start with Bearer prefix',
        headerPreview: redactStringSecrets(authHeader).slice(0, 64)
      };
    }

    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      message: 'Expected format: Authorization: Bearer <your-token>'
    });
  }

  const token = authHeader.substring(7);
  const mappings = loadCustomerMappings();
  const customer = mappings.customers.find(
    (c) => c.bearerToken === token && c.active === true
  );

  if (!customer) {
    if (req.audit) {
      req.audit.authMetadata = {
        state: 'invalid_token',
        detail: 'Bearer token did not match an active customer profile'
      };
    }

    return res.status(403).json({
      error: 'Invalid or inactive bearer token',
      message: 'The provided token is not recognized or has been deactivated'
    });
  }

  req.customer = {
    name: customer.name,
    profileId: customer.profileId,
    ratingOptionId: customer.ratingOptionId
  };

  if (req.audit) {
    req.audit.customerName = customer.name;
    req.audit.profileId = parseInt(customer.profileId, 10);
    req.audit.authMetadata = {
      state: 'authenticated_customer',
      detail: 'Token mapped to active customer',
      customerName: customer.name,
      profileId: parseInt(customer.profileId, 10)
    };
  }

  console.log(`🔑 Authenticated: ${customer.name} (Profile ID: ${customer.profileId})`);
  return next();
}

app.get('/', (req, res) => {
  const mappings = loadCustomerMappings();
  const activeCustomers = mappings.customers.filter((c) => c.active).length;

  res.json({
    status: 'API is running',
    version: '2.0',
    activeCustomers,
    endpoints: {
      health: 'GET /',
      getShippingRates: 'POST /api/shipping-rates (requires Bearer token)'
    },
    authentication: 'Bearer token required in Authorization header'
  });
});

app.post('/api/shipping-rates', attachAuditContext, authenticateCustomer, async (req, res) => {
  try {
    console.log('\n📦 New shipping rate request');
    console.log('Customer:', req.customer.name);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { items, destination } = req.body;

    const destinationCountry = (destination?.country || 'US').toUpperCase();
    const isInternational = destinationCountry !== 'US';
    console.log(`📍 Destination country: ${destinationCountry}, international: ${isInternational}`);

    if (!items || !destination) {
      if (req.audit) {
        req.audit.shipwiseErrorJson = safeJsonString({
          error: 'Missing required fields',
          required: ['items', 'destination']
        });
      }

      return res.status(400).json({
        error: 'Missing required fields',
        required: ['items', 'destination'],
        received: {
          items: !!items,
          destination: !!destination
        }
      });
    }

    const shipwiseRequest = {
      profileId: parseInt(req.customer.profileId, 10),
      ratingOptionId: req.customer.ratingOptionId || 'STANDARD',
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
        const totalValue = (item.value || 0) * (item.quantity || 1);

        const basePackage = {
          packageId: `package_${index + 1}`,
          totalWeight,
          packaging: {
            height: String(item.height || 10),
            length: String(item.length || 10),
            width: String(item.width || 10)
          },
          serviceFlags: ['BPM'],
           "customs": {                
                "consigneeTaxId": "111111"
            }
        };

        if (isInternational) {
          if (!item.harmonizedCode) {
            console.warn(`⚠️ International item missing HS code:`, { sku: item.sku, hasHarmCode: !!item.harmonizedCode });
          }
          if (!item.countryOfOrigin) {
            console.warn(`⚠️ International item missing country of origin:`, { sku: item.sku, hasCountry: !!item.countryOfOrigin });
          }

          basePackage.value = totalValue;
          basePackage.customs = {
            contentsDescription: 'Merchandise',
            originCountry: item.countryOfOrigin || 'US',
            signer: '33 Degrees',
            customsTag: 'Merchandise',
            items: [{
              sku: item.sku || `item-${index + 1}`,
              description: item.customsDescription || item.description || 'Merchandise',
              qty: item.quantity || 1,
              value: item.value || 0,
              weight: item.weight || 0,
              countryOfMfg: item.countryOfOrigin || 'US',
              harmCode: item.harmonizedCode || ''
            }]
          };
        }

        return basePackage;
      })
    };

    if (req.audit) {
      req.audit.shipwiseRequestJson = safeJsonString(shipwiseRequest);
    }

    console.log('📤 Sending to Shipwise API...');
    console.log('Profile ID:', req.customer.profileId);
    console.log('Rating Option ID:', req.customer.ratingOptionId || 'STANDARD');

    const shipwiseBearerToken = process.env.SHIPWISE_BEARER_TOKEN || process.env.BEARER_TOKEN;

    if (!shipwiseBearerToken) {
      if (req.audit) {
        req.audit.shipwiseErrorJson = safeJsonString({
          error: 'Server configuration error',
          message: 'Shipwise API token not configured'
        });
      }

      console.error('❌ Missing SHIPWISE_BEARER_TOKEN in .env file');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Shipwise API token not configured'
      });
    }

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

    if (req.audit) {
      req.audit.shipwiseResponseJson = safeJsonString(shipwiseResponse.data);
    }

    console.log('✅ Shipwise response received');

    if (!shipwiseResponse.data.wasSuccessful) {
      if (req.audit) {
        req.audit.shipwiseErrorJson = safeJsonString({
          message: shipwiseResponse.data.responseMsg,
          details: shipwiseResponse.data
        });
      }

      return res.status(500).json({
        error: 'Failed to get rates from Shipwise',
        message: shipwiseResponse.data.responseMsg,
        details: shipwiseResponse.data
      });
    }

    const rates = [];

    if (shipwiseResponse.data.shipmentItems && shipwiseResponse.data.shipmentItems.length > 0) {
      const packageItem = shipwiseResponse.data.shipmentItems[0];

      if (packageItem.selectedRate) {
        const rate = packageItem.selectedRate;
        rates.push({
          id: rate.carrierService || rate.carrierCode,
          name: `${rate.carrier} ${rate.class}`.trim(),
          carrier: rate.carrier,
          service: rate.class,
          price: parseFloat(rate.value || rate.baseCharge || 0),
          delivery_days: rate.transitTime?.estimatedDeliveryDays || rate.estimatedDeliveryDays || null,
          estimated_delivery: rate.transitTime?.estimatedDelivery || rate.estimatedDelivery || null
        });
      }

      if (packageItem.rates && Array.isArray(packageItem.rates)) {
        packageItem.rates.forEach((rate) => {
          rates.push({
            id: rate.carrierService || rate.carrierCode,
            name: `${rate.carrier} ${rate.class}`.trim(),
            carrier: rate.carrier,
            service: rate.class,
            price: parseFloat(rate.value || rate.baseCharge || 0),
            delivery_days: rate.transitTime?.estimatedDeliveryDays || rate.estimatedDeliveryDays || null,
            estimated_delivery: rate.transitTime?.estimatedDelivery || rate.estimatedDelivery || null
          });
        });
      }
    }

    const uniqueRates = rates.reduce((acc, rate) => {
      if (!acc.find((r) => r.id === rate.id)) {
        acc.push(rate);
      }
      return acc;
    }, []);

    console.log(`✅ Returning ${uniqueRates.length} unique rate(s)`);

    return res.json({
      success: true,
      customer: req.customer.name,
      profileId: req.customer.profileId,
      rates: uniqueRates
    });
  } catch (error) {
    console.error('❌ Error getting shipping rates:', error.message);

    if (req.audit) {
      req.audit.shipwiseErrorJson = safeJsonString({
        message: error.message,
        status: error.response?.status || null,
        data: error.response?.data || null
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        error: 'Failed to get shipping rates from Shipwise',
        details: error.response.data,
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to get shipping rates',
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  initializeAuditLogging();

  console.log('\n' + '='.repeat(50));
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
  console.log('\n' + '='.repeat(50) + '\n');
});
