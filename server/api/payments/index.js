const express = require('express');
const { auth } = require('../../api-util/middlewares');
const checkoutLink = require('./checkout-link');
const verifyPayment = require('./verify-payment');
const router = express.Router();

router.post('/checkout-link', auth, checkoutLink);
router.post('/verify-payment', auth, verifyPayment);

module.exports = router;
