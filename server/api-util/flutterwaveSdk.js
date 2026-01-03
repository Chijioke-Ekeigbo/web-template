const axios = require('axios');

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLUTTERWAVE_BASE_URL = process.env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3';

// Create axios instance with default config for Flutterwave API
// This instance is reused across all Flutterwave API calls
const flutterwaveApi = axios.create({
  baseURL: FLUTTERWAVE_BASE_URL,
  headers: {
    Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

// Add response interceptor to handle errors consistently
flutterwaveApi.interceptors.response.use(
  response => response,
  error => {
    // Transform axios error to a more usable format
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const errorMessage = error.response.data?.message || error.message;
      const statusCode = error.response.status;
      const errorObj = new Error(errorMessage);
      errorObj.status = statusCode;
      errorObj.statusText = error.response.statusText;
      errorObj.data = error.response.data;
      return Promise.reject(errorObj);
    } else if (error.request) {
      // The request was made but no response was received
      const errorObj = new Error('No response received from Flutterwave API');
      errorObj.status = 500;
      return Promise.reject(errorObj);
    } else {
      // Something happened in setting up the request that triggered an Error
      return Promise.reject(error);
    }
  }
);

exports.getFlutterwaveApi = () => {
  if (!FLUTTERWAVE_SECRET_KEY) {
    throw new Error('Flutterwave secret key is not configured');
  }
  return flutterwaveApi;
};

exports.FLUTTERWAVE_SECRET_KEY = FLUTTERWAVE_SECRET_KEY;
exports.FLUTTERWAVE_BASE_URL = FLUTTERWAVE_BASE_URL;
