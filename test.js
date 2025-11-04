const axios = require('axios');

// Test data - replace with your actual test data
const testRequest = {
  items: [
    {
      name: "Test Product",
      quantity: 2,
      weight: 5,
      length: 12,
      width: 8,
      height: 6
    }
  ],
  destination: {
    address1: "123 Test Street",
    address2: "Apt 4B",
    city: "New York",
    state: "NY",
    zip: "10001",
    country: "US"
  }
};

async function testAPI() {
  try {
    console.log('Testing API with request:');
    console.log(JSON.stringify(testRequest, null, 2));
    console.log('\nSending request to http://localhost:3001/api/shipping-rates...\n');

    const response = await axios.post('http://localhost:3001/api/shipping-rates', testRequest);
    
    console.log('✅ Success! Received rates:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing API:');
    console.error('Full error:', error);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      console.error('Response headers:', error.response.headers);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
    console.error('Error stack:', error.stack);
  }
}

// Run the test
console.log('🧪 Starting API Test...\n');
testAPI();