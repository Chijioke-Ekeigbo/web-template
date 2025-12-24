const express = require('express');
const { auth } = require('../../api-util/middlewares');
const checkoutLink = require('./checkout-link');
const router = express.Router();

router.post('/checkout-link', auth, checkoutLink);

module.exports = router;
