const express = require('express');
const { auth } = require('../../api-util/middlewares');
const createPayoutDetails = require('./create');
const updatePayoutDetails = require('./update');
const getPayoutDetails = require('./get');
const router = express.Router();

router.post('/create', auth, createPayoutDetails);
router.post('/update', auth, updatePayoutDetails);
router.post('/', auth, getPayoutDetails);

module.exports = router;
