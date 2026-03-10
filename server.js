const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

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
    c => c.bearerToken === token && c.active === true
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
    profileId: customer.profileId,
    bearerToken: token
  };

  console.log(`🔑 Authenticated: ${customer.name} (Profile ID: ${customer.profileId})`);
  next();
}

// Health check endpoint (no authentication required)
app.get('/', (req, res) => {
  const mappings = loadCustomerMappings();
  const activeCustomers = mappings.customers.filter(c => c.active).length;
  
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
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['items', 'destination'],
        received: {
          items: !!items,
          destination: !!destination
        }
      });
    }

    // Prepare the Shipwise Rate request using authenticated customer's profile
    const shipwiseRequest = {
      profileId: parseInt(req.customer.profileId),
      ratingOptionId: "STANDARD",
      addressVerification: false,
      dateAdvanceDays: 0,
      
      to: {
        id: 0,
        name: destination.name || "Customer",
        company: destination.company || "",
        address1: destination.address1 || "",
        address2: destination.address2 || "",
        city: destination.city || "",
        state: destination.state || "",
        postalCode: destination.zip || destination.postalCode || "",
        countryCode: destination.country || "US",
        phone: destination.phone || "",
        email: destination.email || "",
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
          serviceFlags: ["BPM"]
        };
      })
    };

    console.log('📤 Sending to Shipwise API...');
    console.log('Profile ID:', req.customer.profileId);

    // Call Shipwise API using the Shipwise API bearer token from environment
    const shipwiseBearerToken = process.env.SHIPWISE_BEARER_TOKEN || process.env.BEARER_TOKEN;
    
    if (!shipwiseBearerToken) {
      console.error('❌ Missing SHIPWISE_BEARER_TOKEN in .env file');
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
          'Authorization': `Bearer ${shipwiseBearerToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Shipwise response received');

    // Check if Shipwise request was successful
    if (!shipwiseResponse.data.wasSuccessful) {
      console.error('❌ Shipwise returned unsuccessful:', shipwiseResponse.data.responseMsg);
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
          delivery_days: rate.transitTime?.estimatedDeliveryDays || 
                        rate.estimatedDeliveryDays || 
                        null,
          estimated_delivery: rate.transitTime?.estimatedDelivery || 
                             rate.estimatedDelivery || 
                             null
        });
      }
      
      // Add all available rates
      if (packageItem.rates && Array.isArray(packageItem.rates)) {
        packageItem.rates.forEach(rate => {
          rates.push({
            id: rate.carrierService || rate.carrierCode,
            name: `${rate.carrier} ${rate.class}`.trim(),
            carrier: rate.carrier,
            service: rate.class,
            price: parseFloat(rate.value || rate.baseCharge || 0),
            delivery_days: rate.transitTime?.estimatedDeliveryDays || 
                          rate.estimatedDeliveryDays || 
                          null,
            estimated_delivery: rate.transitTime?.estimatedDelivery || 
                               rate.estimatedDelivery || 
                               null
          });
        });
      }
    }

    // Remove duplicate rates (same ID)
    const uniqueRates = rates.reduce((acc, rate) => {
      if (!acc.find(r => r.id === rate.id)) {
        acc.push(rate);
      }
      return acc;
    }, []);

    console.log(`✅ Returning ${uniqueRates.length} unique rate(s)`);
    console.log('Rates:', JSON.stringify(uniqueRates, null, 2));

    res.json({
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
      
      return res.status(error.response.status).json({
        error: 'Failed to get shipping rates from Shipwise',
        details: error.response.data,
        message: error.message
      });
    } else {
      return res.status(500).json({
        error: 'Failed to get shipping rates',
        message: error.message
      });
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 Shipping Rate API Server');
  console.log('='.repeat(50));
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log(`📦 Endpoint: POST /api/shipping-rates`);
  
  const mappings = loadCustomerMappings();
  const activeCustomers = mappings.customers.filter(c => c.active).length;
  console.log(`🔑 Active customers: ${activeCustomers}`);
  
  console.log('\n📝 Authentication:');
  console.log('   Header: Authorization: Bearer <your-token>');
  console.log('\n' + '='.repeat(50) + '\n');
});