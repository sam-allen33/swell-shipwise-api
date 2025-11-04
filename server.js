const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'API is running',
    endpoints: {
      health: 'GET /',
      getShippingRates: 'POST /api/shipping-rates'
    }
  });
});

// Main endpoint to get shipping rates
app.post('/api/shipping-rates', async (req, res) => {
  try {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    const {
      items,
      destination,
    } = req.body;

    if (!items || !destination) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['items', 'destination']
      });
    }

    // Prepare the Shipwise Rate request
    const shipwiseRequest = {
      profileId: parseInt(process.env.SHIPWISE_PROFILE_ID),
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

    console.log('Sending to Shipwise:', JSON.stringify(shipwiseRequest, null, 2));

    // Call Shipwise API
    const shipwiseResponse = await axios.post(
      'https://api.shipwise.com/api/v1/Rate',
      shipwiseRequest,
      {
        headers: {
          'Authorization': `Bearer ${process.env.SHIPWISE_BEARER_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Shipwise response received');
    console.log('Full response:', JSON.stringify(shipwiseResponse.data, null, 2));

    if (!shipwiseResponse.data.wasSuccessful) {
      console.error('Shipwise returned unsuccessful:', shipwiseResponse.data.responseMsg);
      return res.status(500).json({
        error: 'Failed to get rates from Shipwise',
        message: shipwiseResponse.data.responseMsg,
        details: shipwiseResponse.data
      });
    }

    // Extract rates from Shipwise response
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
          delivery_days: rate.transitTime?.estimatedDeliveryDays || 
                        rate.estimatedDeliveryDays || 
                        null,
          estimated_delivery: rate.transitTime?.estimatedDelivery || 
                             rate.estimatedDelivery || 
                             null
        });
      }
      
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

    const uniqueRates = rates.reduce((acc, rate) => {
      if (!acc.find(r => r.id === rate.id)) {
        acc.push(rate);
      }
      return acc;
    }, []);

    console.log('Formatted rates:', JSON.stringify(uniqueRates, null, 2));

    res.json({
      success: true,
      rates: uniqueRates
    });

  } catch (error) {
    console.error('Error getting shipping rates:');
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

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 Ready to receive shipping rate requests from Swell`);
  console.log(`📋 Using Shipwise Profile ID: ${process.env.SHIPWISE_PROFILE_ID}\n`);
});