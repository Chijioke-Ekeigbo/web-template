const express = require('express');
const bodyParser = require('body-parser');
const { auth } = require('../../api-util/middlewares');
const checkoutLink = require('./checkout-link');
const verifyPayment = require('./verify-payment');
const webhook = require('./webhook');
const router = express.Router();

router.post('/checkout-link', auth, checkoutLink);
router.post('/verify-payment', auth, verifyPayment);

// Flutterwave webhook endpoint
// We use bodyParser.json() here specifically for the webhook to parse the JSON payload from Flutterwave.
// Note: We don't use 'auth' middleware here because the request comes from Flutterwave.
router.post('/webhook', bodyParser.json(), webhook);

module.exports = router;
