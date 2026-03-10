# Shopify App Development Guide: Shipwise Rates Integration

## Document Purpose
This guide provides complete information for building a Shopify app that integrates with the Shipwise Rates API. It includes API specifications, Shopify app architecture, code examples, and step-by-step instructions suitable for language model assistance.

---

## Table of Contents
1. [API Overview](#api-overview)
2. [Complete API Specification](#complete-api-specification)
3. [Shopify App Architecture](#shopify-app-architecture)
4. [Authentication & Security](#authentication--security)
5. [Development Setup](#development-setup)
6. [Implementation Guide](#implementation-guide)
7. [Code Examples](#code-examples)
8. [Testing Procedures](#testing-procedures)
9. [Deployment Guide](#deployment-guide)
10. [Troubleshooting](#troubleshooting)

---

## API Overview

### What is the Shipwise Rates API?

The Shipwise Rates API is a multi-tenant middleware service that:
- Accepts authenticated requests for shipping rate calculations
- Transforms requests to Shipwise API format
- Returns simplified shipping rates from multiple carriers
- Supports 37 active customer profiles with unique authentication tokens

### Base Information

- **API Base URL**: `https://your-vercel-deployment.vercel.app`
- **Current Version**: 2.0
- **Protocol**: HTTPS REST API
- **Authentication**: Bearer Token
- **Content Type**: JSON
- **Response Format**: JSON

---

## Complete API Specification

### Endpoint 1: Health Check

**Purpose**: Check API status and get endpoint documentation

```
GET /
```

**Authentication**: None required

**Response** (200 OK):
```json
{
  "status": "API is running",
  "version": "2.0",
  "activeCustomers": 37,
  "endpoints": {
    "health": "GET /",
    "getShippingRates": "POST /api/shipping-rates (requires Bearer token)"
  },
  "authentication": "Bearer token required in Authorization header"
}
```

**Use Case**: Verify API availability before making authenticated requests

---

### Endpoint 2: Get Shipping Rates

**Purpose**: Calculate shipping rates for packages to a destination

```
POST /api/shipping-rates
```

**Authentication**: Required (Bearer Token)

**Headers**:
```http
Authorization: Bearer <customer-bearer-token>
Content-Type: application/json
```

**Request Body Schema**:
```json
{
  "items": [
    {
      "name": "string (optional)",
      "quantity": "number (required, default: 1)",
      "weight": "number (required, in pounds, default: 1)",
      "length": "number (required, in inches, default: 10)",
      "width": "number (required, in inches, default: 10)",
      "height": "number (required, in inches, default: 10)"
    }
  ],
  "destination": {
    "name": "string (optional)",
    "company": "string (optional)",
    "address1": "string (required)",
    "address2": "string (optional)",
    "city": "string (required)",
    "state": "string (required, 2-letter code)",
    "zip": "string (required)",
    "postalCode": "string (alternative to zip)",
    "country": "string (optional, default: US, 2-letter code)",
    "phone": "string (optional)",
    "email": "string (optional)"
  }
}
```

**Example Request**:
```json
{
  "items": [
    {
      "name": "T-Shirt",
      "quantity": 2,
      "weight": 0.5,
      "length": 12,
      "width": 9,
      "height": 2
    }
  ],
  "destination": {
    "name": "John Doe",
    "address1": "123 Main Street",
    "address2": "Apt 4B",
    "city": "New York",
    "state": "NY",
    "zip": "10001",
    "country": "US",
    "phone": "555-123-4567",
    "email": "john@example.com"
  }
}
```

**Success Response** (200 OK):
```json
{
  "success": true,
  "customer": "Customer Name",
  "profileId": "7008592",
  "rates": [
    {
      "id": "USPS_GROUND_ADVANTAGE",
      "name": "USPS Ground Advantage",
      "carrier": "USPS",
      "service": "Ground Advantage",
      "price": 12.45,
      "delivery_days": 3,
      "estimated_delivery": "2025-12-07"
    },
    {
      "id": "UPS_GROUND",
      "name": "UPS Ground",
      "carrier": "UPS",
      "service": "Ground",
      "price": 15.20,
      "delivery_days": 2,
      "estimated_delivery": "2025-12-06"
    }
  ]
}
```

**Rate Object Schema**:
- `id` (string): Unique identifier for the shipping service
- `name` (string): Human-readable service name
- `carrier` (string): Carrier name (USPS, UPS, FedEx, etc.)
- `service` (string): Service class (Ground, Express, etc.)
- `price` (number): Shipping cost in USD
- `delivery_days` (number|null): Estimated delivery time in days
- `estimated_delivery` (string|null): Estimated delivery date (YYYY-MM-DD)

**Error Responses**:

**401 Unauthorized** - Missing or malformed Authorization header
```json
{
  "error": "Missing or invalid Authorization header",
  "message": "Expected format: Authorization: Bearer <your-token>"
}
```

**403 Forbidden** - Invalid or inactive bearer token
```json
{
  "error": "Invalid or inactive bearer token",
  "message": "The provided token is not recognized or has been deactivated"
}
```

**400 Bad Request** - Missing required fields
```json
{
  "error": "Missing required fields",
  "required": ["items", "destination"],
  "received": {
    "items": true,
    "destination": false
  }
}
```

**500 Internal Server Error** - Shipwise API error
```json
{
  "error": "Failed to get shipping rates from Shipwise",
  "message": "Error details",
  "details": {}
}
```

---

## Shopify App Architecture

### Overview: What You'll Build

A Shopify app that provides real-time shipping rates at checkout by integrating with the Shipwise Rates API.

### App Type: Carrier Service App

Your app will be a **Carrier Calculated Shipping** app that:
1. Registers as a shipping carrier in Shopify
2. Receives shipping rate requests from Shopify during checkout
3. Calls the Shipwise Rates API
4. Returns formatted rates to Shopify
5. Displays rates to customers at checkout

### Architecture Diagram

```
Customer Checkout
       ↓
Shopify Store
       ↓
Shopify API (shipping rate request)
       ↓
Your Shopify App (Node.js/Express)
       ↓
Shipwise Rates API (Bearer Token Auth)
       ↓
Shipwise Service
       ↓
Multiple Carriers (USPS, UPS, FedEx)
       ↓
Returns rates up the chain
       ↓
Displayed at checkout
```

### Tech Stack Recommendation

**Backend**:
- **Framework**: Node.js with Express.js
- **Shopify Library**: @shopify/shopify-api
- **HTTP Client**: Axios or Fetch
- **Hosting**: Vercel, Heroku, Railway, or DigitalOcean

**Frontend** (Admin Panel):
- **Framework**: React
- **UI Library**: Shopify Polaris
- **State Management**: React Context or Redux

**Database** (Optional):
- PostgreSQL or MongoDB for settings storage
- Store merchant preferences, mapping configurations

---

## Authentication & Security

### Two-Layer Authentication System

Your app needs to handle **two separate authentication systems**:

#### Layer 1: Shopify Authentication (OAuth)

**Purpose**: Authenticate merchants installing your app

**Flow**:
1. Merchant clicks "Install App" in Shopify App Store
2. Shopify redirects to your app with shop parameter
3. Your app initiates OAuth flow
4. Merchant approves permissions
5. Your app receives access token
6. Store access token securely for API calls

**Required Scopes**:
```javascript
const SCOPES = [
  'write_shipping',
  'read_orders',
  'read_products'
];
```

**Implementation** (using @shopify/shopify-api):
```javascript
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: SCOPES,
  hostName: process.env.HOST,
  apiVersion: '2024-01'
});
```

#### Layer 2: Shipwise Rates API Authentication (Bearer Token)

**Purpose**: Authenticate your app when calling Shipwise Rates API

**Token Management Strategies**:

**Option A: Single Token (Simple)**
- Use one bearer token for all merchants
- Store in environment variables
- All merchants map to same Shipwise profile
- **Limitation**: No per-merchant rate customization

**Option B: Per-Merchant Tokens (Advanced)**
- Each merchant gets their own bearer token
- Map Shopify shop ID to specific bearer token
- Store in database
- Allows per-merchant Shipwise profiles
- **Best for**: Apps serving multiple fulfillment centers

**Option C: Admin-Configured Token**
- Merchants enter their bearer token in app settings
- Store encrypted in database
- **Best for**: Merchants with their own Shipwise accounts

### Security Best Practices

1. **Never expose tokens in client-side code**
2. **Use environment variables for secrets**
3. **Validate webhook signatures**
4. **Use HTTPS only**
5. **Implement rate limiting**
6. **Log authentication failures**
7. **Encrypt tokens at rest**

### Example Token Storage (Database)

```sql
CREATE TABLE merchant_settings (
  id SERIAL PRIMARY KEY,
  shop_domain VARCHAR(255) UNIQUE NOT NULL,
  shipwise_bearer_token VARCHAR(500) NOT NULL,
  shipwise_profile_id VARCHAR(50),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Shopify Partner account
- ngrok or similar tunneling service (for local development)
- Shipwise Rates API bearer token
- Code editor (VS Code recommended)

### Step 1: Create Shopify Partner Account

1. Go to https://partners.shopify.com
2. Sign up for a free account
3. Create a development store (Settings → Stores → Add store)
4. Note: Development stores are free and perfect for testing

### Step 2: Create App in Partner Dashboard

1. Navigate to Apps in Partner Dashboard
2. Click "Create App"
3. Choose "Public App" or "Custom App"
4. Fill in app details:
   - **App name**: "Shipwise Shipping Rates"
   - **App URL**: https://your-domain.com (will update with ngrok)
   - **Allowed redirection URL(s)**: https://your-domain.com/auth/callback

### Step 3: Get API Credentials

After creating the app, you'll receive:
- **API Key**: Your app's public identifier
- **API Secret**: Your app's private key (keep secret!)
- **Client ID**: Alternative identifier

Save these credentials securely.

### Step 4: Initialize Node.js Project

```bash
mkdir shopify-shipwise-app
cd shopify-shipwise-app
npm init -y
```

### Step 5: Install Dependencies

```bash
npm install express @shopify/shopify-api dotenv axios cors
npm install --save-dev nodemon
```

**Package purposes**:
- `express`: Web framework
- `@shopify/shopify-api`: Official Shopify library
- `dotenv`: Environment variable management
- `axios`: HTTP client for API calls
- `cors`: Cross-origin resource sharing
- `nodemon`: Auto-restart during development

### Step 6: Create Environment Variables

Create `.env` file:

```env
# Shopify App Credentials
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SHOPIFY_APP_SCOPES=write_shipping,read_orders,read_products
SHOPIFY_HOST=your-app.ngrok.io

# Shipwise Rates API
SHIPWISE_API_URL=https://your-vercel-deployment.vercel.app
SHIPWISE_BEARER_TOKEN=your_bearer_token_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Database (if using)
DATABASE_URL=postgresql://localhost/shopify_shipwise
```

### Step 7: Setup ngrok for Local Development

```bash
# Install ngrok
npm install -g ngrok

# Start ngrok tunnel
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and update:
1. Your `.env` file (`SHOPIFY_HOST`)
2. Shopify Partner Dashboard app URLs
3. Allowed redirection URLs

### Step 8: Project Structure

```
shopify-shipwise-app/
├── .env
├── .gitignore
├── package.json
├── server.js
├── routes/
│   ├── auth.js
│   ├── webhooks.js
│   └── carrier-service.js
├── services/
│   ├── shopify.js
│   └── shipwise.js
├── middleware/
│   ├── verify-request.js
│   └── error-handler.js
├── utils/
│   ├── logger.js
│   └── rate-formatter.js
└── frontend/
    ├── pages/
    │   └── index.jsx
    └── components/
```

---

## Implementation Guide

### Phase 1: Basic Express Server Setup

**File: `server.js`**

```javascript
require('dotenv').config();
const express = require('express');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_APP_SCOPES.split(','),
  hostName: process.env.SHOPIFY_HOST.replace(/https:\/\//, ''),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  isCustomStoreApp: false,
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes (will implement next)
// app.use('/auth', require('./routes/auth'));
// app.use('/webhooks', require('./routes/webhooks'));
// app.use('/carrier-service', require('./routes/carrier-service'));

app.listen(PORT, () => {
  console.log(`✅ Shopify app running on port ${PORT}`);
  console.log(`🌐 Public URL: https://${process.env.SHOPIFY_HOST}`);
});

module.exports = { shopify };
```

### Phase 2: OAuth Authentication

**File: `routes/auth.js`**

```javascript
const express = require('express');
const router = express.Router();
const { shopify } = require('../server');

// Step 1: Begin OAuth
router.get('/shopify', async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  // Validate shop format
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  if (!shopRegex.test(shop)) {
    return res.status(400).send('Invalid shop domain');
  }

  try {
    // Begin OAuth process
    await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
  } catch (error) {
    console.error('OAuth begin error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Step 2: OAuth Callback
router.get('/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;
    const { shop, accessToken } = session;

    // TODO: Store session in database
    console.log(`✅ Successfully authenticated shop: ${shop}`);
    console.log(`Access token: ${accessToken.substring(0, 10)}...`);

    // Step 3: Register carrier service
    await registerCarrierService(shop, accessToken);

    // Redirect to app
    res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication callback failed');
  }
});

// Register carrier service with Shopify
async function registerCarrierService(shop, accessToken) {
  const client = new shopify.clients.Rest({ session: { shop, accessToken } });

  try {
    // Check if carrier service already exists
    const response = await client.get({
      path: 'carrier_services',
    });

    const existingService = response.body.carrier_services.find(
      (service) => service.name === 'Shipwise Shipping'
    );

    if (existingService) {
      console.log('Carrier service already exists');
      return;
    }

    // Create new carrier service
    await client.post({
      path: 'carrier_services',
      data: {
        carrier_service: {
          name: 'Shipwise Shipping',
          callback_url: `https://${process.env.SHOPIFY_HOST}/carrier-service/rates`,
          service_discovery: true,
        },
      },
    });

    console.log('✅ Carrier service registered successfully');
  } catch (error) {
    console.error('Error registering carrier service:', error);
    throw error;
  }
}

module.exports = router;
```

### Phase 3: Carrier Service Endpoint (Core Logic)

**File: `routes/carrier-service.js`**

```javascript
const express = require('express');
const router = express.Router();
const axios = require('axios');

// Main endpoint that Shopify calls during checkout
router.post('/rates', async (req, res) => {
  try {
    console.log('📦 Received rate request from Shopify');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { rate } = req.body;

    // Extract shipping details from Shopify request
    const items = rate.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      weight: item.grams / 453.592, // Convert grams to pounds
      // Note: Shopify doesn't provide dimensions by default
      // You'll need to store these in product metafields
      length: 10, // Default values
      width: 10,
      height: 10,
    }));

    const destination = {
      name: `${rate.destination.first_name || ''} ${rate.destination.last_name || ''}`.trim(),
      company: rate.destination.company || '',
      address1: rate.destination.address1,
      address2: rate.destination.address2 || '',
      city: rate.destination.city,
      state: rate.destination.province_code,
      zip: rate.destination.postal_code,
      country: rate.destination.country_code,
      phone: rate.destination.phone || '',
      email: rate.destination.email || '',
    };

    // Call Shipwise Rates API
    const shipwiseResponse = await axios.post(
      `${process.env.SHIPWISE_API_URL}/api/shipping-rates`,
      {
        items,
        destination,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SHIPWISE_BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Received rates from Shipwise API');

    // Transform Shipwise rates to Shopify format
    const shopifyRates = shipwiseResponse.data.rates.map((rate) => ({
      service_name: rate.name,
      service_code: rate.id,
      total_price: (rate.price * 100).toFixed(0), // Convert to cents
      currency: 'USD',
      min_delivery_date: rate.estimated_delivery || null,
      max_delivery_date: rate.estimated_delivery || null,
    }));

    console.log(`✅ Returning ${shopifyRates.length} rates to Shopify`);

    // Return rates to Shopify
    res.json({
      rates: shopifyRates,
    });
  } catch (error) {
    console.error('❌ Error getting shipping rates:', error.message);

    if (error.response) {
      console.error('API Response:', error.response.data);
    }

    // Return empty rates on error (Shopify requirement)
    res.json({
      rates: [],
    });
  }
});

module.exports = router;
```

### Phase 4: Webhook Handler (Optional but Recommended)

**File: `routes/webhooks.js`**

```javascript
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Verify webhook signature
function verifyWebhook(req, res, next) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const body = req.rawBody; // Need raw body for verification

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  if (hash === hmac) {
    next();
  } else {
    res.status(401).send('Invalid webhook signature');
  }
}

// App uninstalled webhook
router.post('/app/uninstalled', verifyWebhook, async (req, res) => {
  const shop = req.headers['x-shopify-shop-domain'];
  console.log(`❌ App uninstalled from shop: ${shop}`);

  // TODO: Clean up database records, revoke tokens, etc.

  res.status(200).send('Webhook processed');
});

module.exports = router;
```

### Phase 5: Complete Server with All Routes

**File: `server.js` (Updated)**

```javascript
require('dotenv').config();
const express = require('express');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_APP_SCOPES.split(','),
  hostName: process.env.SHOPIFY_HOST.replace(/https:\/\//, ''),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/webhooks', require('./routes/webhooks'));
app.use('/carrier-service', require('./routes/carrier-service'));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Shopify Shipwise App Server');
  console.log('='.repeat(60));
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`🌐 Public URL: https://${process.env.SHOPIFY_HOST}`);
  console.log(`🔗 Install URL: https://${process.env.SHOPIFY_HOST}/auth/shopify?shop=YOUR-STORE.myshopify.com`);
  console.log('='.repeat(60) + '\n');
});

module.exports = { shopify };
```

---

## Code Examples

### Example 1: Enhanced Rate Calculation with Product Dimensions

Many Shopify products don't have dimensions. Here's how to handle that:

**Solution: Use Product Metafields**

```javascript
// Fetch product dimensions from metafields
async function getProductDimensions(productId, shop, accessToken) {
  const client = new shopify.clients.Rest({ session: { shop, accessToken } });

  try {
    const response = await client.get({
      path: `products/${productId}/metafields`,
    });

    const metafields = response.body.metafields;

    const length = metafields.find((m) => m.key === 'length')?.value || 10;
    const width = metafields.find((m) => m.key === 'width')?.value || 10;
    const height = metafields.find((m) => m.key === 'height')?.value || 10;

    return { length, width, height };
  } catch (error) {
    console.error('Error fetching metafields:', error);
    return { length: 10, width: 10, height: 10 }; // Defaults
  }
}

// Updated carrier service with dimension lookup
router.post('/rates', async (req, res) => {
  const { rate } = req.body;

  // Get shop from request (you'll need to validate this)
  const shop = req.headers['x-shopify-shop-domain'];
  const accessToken = await getAccessToken(shop); // Your session storage

  const items = await Promise.all(
    rate.items.map(async (item) => {
      const dimensions = await getProductDimensions(item.product_id, shop, accessToken);

      return {
        name: item.name,
        quantity: item.quantity,
        weight: item.grams / 453.592,
        ...dimensions,
      };
    })
  );

  // ... rest of the rate calculation
});
```

### Example 2: Rate Markup/Adjustment

Add handling fees or markups to rates:

```javascript
function applyRateAdjustment(rate, markupType, markupValue) {
  let adjustedPrice = rate.price;

  if (markupType === 'percentage') {
    adjustedPrice = rate.price * (1 + markupValue / 100);
  } else if (markupType === 'fixed') {
    adjustedPrice = rate.price + markupValue;
  }

  return {
    ...rate,
    price: Math.round(adjustedPrice * 100) / 100, // Round to 2 decimals
  };
}

// Usage in carrier service
const adjustedRates = shipwiseResponse.data.rates.map((rate) =>
  applyRateAdjustment(rate, 'percentage', 15) // 15% markup
);
```

### Example 3: Free Shipping Threshold

Offer free shipping over a certain amount:

```javascript
function calculateTotalOrderValue(items) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

router.post('/rates', async (req, res) => {
  const { rate } = req.body;

  // Calculate order total
  const orderTotal = calculateTotalOrderValue(rate.items);
  const freeShippingThreshold = 100; // $100

  // Get rates from API
  const shipwiseResponse = await getShipwiseRates(/* ... */);

  let shopifyRates = shipwiseResponse.data.rates.map((rate) => ({
    service_name: rate.name,
    service_code: rate.id,
    total_price: (rate.price * 100).toFixed(0),
    currency: 'USD',
  }));

  // Add free shipping option if threshold met
  if (orderTotal >= freeShippingThreshold) {
    shopifyRates.unshift({
      service_name: 'Free Shipping',
      service_code: 'FREE_SHIPPING',
      total_price: '0',
      currency: 'USD',
      description: `Free shipping on orders over $${freeShippingThreshold}`,
    });
  }

  res.json({ rates: shopifyRates });
});
```

### Example 4: Database Session Storage

Store merchant sessions in PostgreSQL:

```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Save session
async function saveSession(shop, accessToken, scope) {
  const query = `
    INSERT INTO shopify_sessions (shop, access_token, scope)
    VALUES ($1, $2, $3)
    ON CONFLICT (shop) DO UPDATE
    SET access_token = $2, scope = $3, updated_at = NOW()
  `;

  await pool.query(query, [shop, accessToken, scope]);
}

// Get session
async function getSession(shop) {
  const query = 'SELECT * FROM shopify_sessions WHERE shop = $1';
  const result = await pool.query(query, [shop]);
  return result.rows[0];
}

// Use in auth callback
router.get('/callback', async (req, res) => {
  const callback = await shopify.auth.callback({
    rawRequest: req,
    rawResponse: res,
  });

  const { session } = callback;
  await saveSession(session.shop, session.accessToken, session.scope);

  // ... rest of callback
});
```

### Example 5: Admin Settings Page (React)

**File: `frontend/pages/index.jsx`**

```javascript
import { Page, Card, FormLayout, TextField, Button, Banner } from '@shopify/polaris';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [bearerToken, setBearerToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    // Load current settings
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => setBearerToken(data.bearerToken || ''));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bearerToken }),
      });

      setBanner({ status: 'success', message: 'Settings saved successfully!' });
    } catch (error) {
      setBanner({ status: 'critical', message: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="Shipwise Shipping Settings">
      {banner && (
        <Banner status={banner.status} onDismiss={() => setBanner(null)}>
          {banner.message}
        </Banner>
      )}

      <Card sectioned>
        <FormLayout>
          <TextField
            label="Shipwise Bearer Token"
            value={bearerToken}
            onChange={setBearerToken}
            type="password"
            helpText="Enter your Shipwise API bearer token"
          />

          <Button primary loading={saving} onClick={handleSave}>
            Save Settings
          </Button>
        </FormLayout>
      </Card>
    </Page>
  );
}
```

---

## Testing Procedures

### Test 1: OAuth Installation Flow

1. Start your local server: `npm run dev`
2. Start ngrok: `ngrok http 3000`
3. Update app URLs in Partner Dashboard with ngrok URL
4. Visit: `https://your-app.ngrok.io/auth/shopify?shop=your-dev-store.myshopify.com`
5. Verify OAuth prompt appears
6. Click "Install"
7. Verify redirect to app and carrier service registration

**Expected Console Output**:
```
✅ Successfully authenticated shop: your-store.myshopify.com
Access token: shpat_abc...
✅ Carrier service registered successfully
```

### Test 2: Carrier Service Registration

Check if carrier service was created:

1. Go to your development store admin
2. Navigate to: Settings → Shipping and delivery
3. Click on a shipping zone
4. Click "Add rate"
5. Look for "Use carrier or app to calculate rates"
6. Verify "Shipwise Shipping" appears in the list

### Test 3: Rate Calculation at Checkout

1. Add products to cart in your development store
2. Proceed to checkout
3. Enter a shipping address
4. Verify shipping rates appear
5. Check your app logs for rate request

**Expected Shopify Request**:
```json
{
  "rate": {
    "origin": { ... },
    "destination": { ... },
    "items": [
      {
        "name": "Product Name",
        "sku": "SKU123",
        "quantity": 1,
        "grams": 500,
        "price": 2999,
        "vendor": "Your Store",
        "requires_shipping": true,
        "taxable": true,
        "fulfillment_service": "manual"
      }
    ],
    "currency": "USD",
    "locale": "en"
  }
}
```

### Test 4: API Error Handling

Simulate API failures:

**Test Invalid Token**:
```javascript
// Temporarily change bearer token in .env
SHIPWISE_BEARER_TOKEN=invalid-token
```

Expected: Empty rates returned to Shopify (prevents checkout errors)

**Test API Timeout**:
```javascript
// Add timeout to axios call
axios.post(url, data, {
  headers: { ... },
  timeout: 1 // 1ms timeout
});
```

Expected: Graceful error, empty rates returned

### Test 5: End-to-End Integration Test

**File: `test/integration.test.js`**

```javascript
const axios = require('axios');

async function testFullFlow() {
  console.log('🧪 Starting integration test...\n');

  const testData = {
    rate: {
      destination: {
        country_code: 'US',
        province_code: 'NY',
        city: 'New York',
        postal_code: '10001',
        address1: '123 Test St',
      },
      items: [
        {
          name: 'Test Product',
          quantity: 1,
          grams: 500,
          price: 2999,
        },
      ],
    },
  };

  try {
    const response = await axios.post(
      'http://localhost:3000/carrier-service/rates',
      testData
    );

    console.log('✅ Test passed!');
    console.log('Rates returned:', response.data.rates.length);
    console.log('Rates:', JSON.stringify(response.data.rates, null, 2));
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testFullFlow();
```

Run with: `node test/integration.test.js`

---

## Deployment Guide

### Option 1: Deploy to Vercel

**Step 1: Install Vercel CLI**
```bash
npm install -g vercel
```

**Step 2: Create `vercel.json`**
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ],
  "env": {
    "SHOPIFY_API_KEY": "@shopify-api-key",
    "SHOPIFY_API_SECRET": "@shopify-api-secret",
    "SHIPWISE_BEARER_TOKEN": "@shipwise-bearer-token"
  }
}
```

**Step 3: Deploy**
```bash
vercel login
vercel --prod
```

**Step 4: Set Environment Variables**
```bash
vercel env add SHOPIFY_API_KEY
vercel env add SHOPIFY_API_SECRET
vercel env add SHIPWISE_BEARER_TOKEN
```

**Step 5: Update App URLs**
Update your Shopify Partner Dashboard with production URL

### Option 2: Deploy to Heroku

**Step 1: Create Heroku App**
```bash
heroku create your-app-name
```

**Step 2: Set Environment Variables**
```bash
heroku config:set SHOPIFY_API_KEY=your_key
heroku config:set SHOPIFY_API_SECRET=your_secret
heroku config:set SHIPWISE_BEARER_TOKEN=your_token
```

**Step 3: Deploy**
```bash
git push heroku main
```

**Step 4: Check Logs**
```bash
heroku logs --tail
```

### Option 3: Deploy to Railway

1. Connect GitHub repository
2. Add environment variables in dashboard
3. Deploy automatically on push

### Post-Deployment Checklist

- [ ] Update app URLs in Shopify Partner Dashboard
- [ ] Update redirect URLs
- [ ] Test OAuth flow with production URL
- [ ] Test rate calculation in live store
- [ ] Enable app listing (if public)
- [ ] Set up monitoring (e.g., Sentry)
- [ ] Configure logging
- [ ] Set up SSL (handled by hosting provider)
- [ ] Test webhooks

---

## Troubleshooting

### Issue 1: "Invalid shop domain" during OAuth

**Cause**: Shop parameter missing or malformed

**Solution**:
```javascript
// Add debugging
console.log('Shop parameter:', req.query.shop);

// Validate format
if (!req.query.shop || !req.query.shop.endsWith('.myshopify.com')) {
  return res.status(400).send('Invalid shop');
}
```

### Issue 2: Carrier service not appearing

**Cause**:
- Not registered during installation
- Wrong callback URL
- API credentials incorrect

**Solution**:
```javascript
// Manually check carrier services
const response = await client.get({ path: 'carrier_services' });
console.log('Carrier services:', response.body.carrier_services);

// Verify callback URL is accessible
console.log('Callback URL:', `https://${process.env.SHOPIFY_HOST}/carrier-service/rates`);
```

### Issue 3: No rates appearing at checkout

**Cause**:
- Endpoint not responding
- Returning wrong format
- Shipwise API error
- Bearer token invalid

**Solution**:
```javascript
// Add extensive logging
router.post('/rates', async (req, res) => {
  console.log('=== RATE REQUEST ===');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    // Your rate logic

    console.log('Returning rates:', shopifyRates);
    res.json({ rates: shopifyRates });
  } catch (error) {
    console.error('ERROR:', error);
    res.json({ rates: [] }); // Always return valid format
  }
});
```

### Issue 4: "403 Forbidden" from Shipwise API

**Cause**: Invalid bearer token

**Solution**:
```bash
# Test bearer token directly
curl -X POST https://your-api.vercel.app/api/shipping-rates \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"weight": 1, "length": 10, "width": 10, "height": 10, "quantity": 1}],
    "destination": {"address1": "123 Main St", "city": "New York", "state": "NY", "zip": "10001", "country": "US"}
  }'
```

### Issue 5: Rates in wrong currency

**Shopify expects prices in cents (minor units)**

**Solution**:
```javascript
// Wrong
total_price: 12.45  // Will show as $0.12

// Correct
total_price: (12.45 * 100).toFixed(0)  // Shows as $12.45
```

### Issue 6: Webhook signature verification fails

**Cause**: Using parsed body instead of raw body

**Solution**:
```javascript
// Add raw body parser
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// In webhook handler
function verifyWebhook(req, res, next) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const body = req.body; // Now raw buffer

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body)
    .digest('base64');

  if (hash === hmac) {
    req.body = JSON.parse(body); // Parse for handler
    next();
  } else {
    res.status(401).send('Invalid signature');
  }
}
```

---

## Advanced Features (Future Enhancements)

### 1. Admin Dashboard

Build a full settings page where merchants can:
- Configure markup percentages
- Set free shipping thresholds
- Map product types to packaging dimensions
- View rate request logs
- Test API connection

### 2. Rate Caching

Cache rates for identical requests:

```javascript
const NodeCache = require('node-cache');
const rateCache = new NodeCache({ stdTTL: 300 }); // 5 minutes

router.post('/rates', async (req, res) => {
  const cacheKey = JSON.stringify(req.body);
  const cached = rateCache.get(cacheKey);

  if (cached) {
    console.log('✅ Returning cached rates');
    return res.json({ rates: cached });
  }

  // Fetch rates from API
  const rates = await fetchRates(req.body);
  rateCache.set(cacheKey, rates);
  res.json({ rates });
});
```

### 3. Multi-Warehouse Support

Allow merchants to configure multiple origins:

```javascript
// Determine origin based on product location
function selectOriginByProduct(items) {
  // Logic to determine which warehouse should fulfill
  // Based on product tags, inventory location, etc.
  return {
    warehouseId: 'WEST_COAST',
    bearerToken: 'warehouse-specific-token',
  };
}
```

### 4. Rate Fallback

If Shipwise API fails, fall back to default rates:

```javascript
const DEFAULT_RATES = [
  { service_name: 'Standard Shipping', total_price: '599', currency: 'USD' },
  { service_name: 'Express Shipping', total_price: '1299', currency: 'USD' },
];

try {
  const rates = await fetchShipwiseRates();
  res.json({ rates });
} catch (error) {
  console.error('API failed, using fallback rates');
  res.json({ rates: DEFAULT_RATES });
}
```

### 5. Analytics & Monitoring

Track rate requests and performance:

```javascript
const analytics = {
  requests: 0,
  errors: 0,
  avgResponseTime: 0,
};

router.post('/rates', async (req, res) => {
  const startTime = Date.now();
  analytics.requests++;

  try {
    const rates = await fetchRates();
    res.json({ rates });
  } catch (error) {
    analytics.errors++;
    res.json({ rates: [] });
  } finally {
    const duration = Date.now() - startTime;
    analytics.avgResponseTime =
      (analytics.avgResponseTime * (analytics.requests - 1) + duration) /
      analytics.requests;
  }
});

// Expose metrics
app.get('/metrics', (req, res) => {
  res.json(analytics);
});
```

---

## API Reference Quick Sheet

### Shipwise Rates API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/` | No | Health check |
| POST | `/api/shipping-rates` | Bearer | Get shipping rates |

### Required Headers

```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Request Schema

```json
{
  "items": [{"weight": 1, "length": 10, "width": 10, "height": 10, "quantity": 1}],
  "destination": {"address1": "...", "city": "...", "state": "...", "zip": "...", "country": "US"}
}
```

### Response Schema

```json
{
  "success": true,
  "rates": [
    {"id": "...", "name": "...", "price": 12.45, "delivery_days": 3}
  ]
}
```

---

## Shopify API Reference

### Key Endpoints Your App Uses

| Endpoint | Purpose |
|----------|---------|
| `POST /admin/oauth/access_token` | Complete OAuth |
| `GET /admin/carrier_services.json` | List carrier services |
| `POST /admin/carrier_services.json` | Register carrier service |
| `GET /admin/products/{id}/metafields.json` | Get product dimensions |

### Carrier Service Callback Format

Shopify sends:
```json
{
  "rate": {
    "origin": {...},
    "destination": {...},
    "items": [{...}],
    "currency": "USD",
    "locale": "en"
  }
}
```

You return:
```json
{
  "rates": [
    {
      "service_name": "USPS Ground",
      "service_code": "USPS_GROUND",
      "total_price": "1245",
      "currency": "USD",
      "min_delivery_date": "2025-12-07",
      "max_delivery_date": "2025-12-10"
    }
  ]
}
```

---

## Environment Variables Reference

### Required

```env
SHOPIFY_API_KEY=<from partner dashboard>
SHOPIFY_API_SECRET=<from partner dashboard>
SHOPIFY_APP_SCOPES=write_shipping,read_orders,read_products
SHOPIFY_HOST=<your-domain.com>
SHIPWISE_API_URL=<api base url>
SHIPWISE_BEARER_TOKEN=<bearer token>
PORT=3000
```

### Optional

```env
NODE_ENV=development|production
DATABASE_URL=<postgres connection string>
REDIS_URL=<redis connection string>
SENTRY_DSN=<sentry error tracking>
LOG_LEVEL=debug|info|error
```

---

## Useful Resources

### Documentation

- Shopify API Docs: https://shopify.dev/docs/api
- Carrier Service Guide: https://shopify.dev/docs/apps/shipping/delivery-customizations/carrier-service
- Shopify App CLI: https://shopify.dev/docs/apps/tools/cli
- @shopify/shopify-api: https://github.com/Shopify/shopify-api-js

### Testing Tools

- ngrok: https://ngrok.com
- Postman: https://www.postman.com
- Shopify GraphiQL: https://shopify.dev/docs/apps/tools/graphiql-admin-api

### Deployment

- Vercel: https://vercel.com
- Heroku: https://heroku.com
- Railway: https://railway.app

---

## Support & Next Steps

### Getting Help

1. **Shopify Community Forums**: https://community.shopify.com/c/shopify-apps/bd-p/shopify-apps
2. **Shopify Partners Slack**: https://shopify.dev/slack
3. **API Status**: https://www.shopifystatus.com

### Next Steps After Building

1. **Test thoroughly** in development store
2. **Create app listing** in Partner Dashboard
3. **Submit for review** (if public app)
4. **Set up support** email/portal
5. **Create documentation** for merchants
6. **Monitor errors** with Sentry or similar
7. **Iterate based on feedback**

---

## Conclusion

This guide provides everything needed to build a Shopify app that integrates with the Shipwise Rates API. The app will:

1. ✅ Authenticate merchants via OAuth
2. ✅ Register as a carrier service in Shopify
3. ✅ Receive rate requests during checkout
4. ✅ Call Shipwise Rates API with bearer token authentication
5. ✅ Transform and return rates to Shopify
6. ✅ Display real-time shipping rates to customers

**Key Success Factors**:
- Proper OAuth implementation
- Correct carrier service registration
- Accurate data transformation between APIs
- Robust error handling
- Secure credential management

**Estimated Development Time**: 2-4 days for MVP, 1-2 weeks for production-ready app with admin panel and advanced features.

---

## Document Metadata

- **Version**: 1.0
- **Last Updated**: 2025-12-04
- **API Version**: Shipwise Rates API v2.0
- **Shopify API Version**: 2024-01 (LATEST)
- **Author**: Development Guide for LLM-Assisted Development
- **Purpose**: Complete reference for building Shopify carrier service app with Shipwise integration
