const { getFlutterwaveApi } = require('../../api-util/flutterwaveSdk');
const { getIntegrationSdk } = require('../../api-util/sdk');
const { denormalisedResponseEntities } = require('../../api-util/format');

/**
 * Confirm the payment in Sharetribe by transitioning the transaction.
 */
const confirmPayment = async (integrationSdk, sharetribeTransactionId, flwTransactionId) => {
  // 1. Fetch the transaction from Sharetribe to check its current state
  const txResponse = await integrationSdk.transactions.show({
    id: sharetribeTransactionId,
  });
  const [tx] = denormalisedResponseEntities(txResponse);

  if (!tx) {
    throw new Error(`Sharetribe transaction not found: ${sharetribeTransactionId}`);
  }

  // 2. Transition the transaction if it's still in 'pending-payment' state
  if (tx.attributes.state === 'state/pending-payment') {
    console.log(`Webhook: Transitioning transaction ${sharetribeTransactionId} to purchased.`);

    // We use a specific transition for webhooks to distinguish from customer-led transitions
    return await integrationSdk.transactions.transition({
      id: sharetribeTransactionId,
      transition: 'transition/confirm-payment-via-webhook',
      params: {},
    });
  } else {
    console.log(
      `Webhook: Transaction ${sharetribeTransactionId} already in state ${tx.attributes.state}.`
    );
    return tx;
  }
};

/**
 * Flutterwave Webhook handler
 * This endpoint is called by Flutterwave to notify about transaction events.
 */
const webhook = async (req, res) => {
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  const signature = req.headers['verif-hash'];

  // 1. Verify the webhook signature if a secret hash is configured
  if (secretHash && (!signature || signature !== secretHash)) {
    return res.status(401).send('Invalid signature');
  }

  const payload = req.body;
  const event = payload['event.type'];
  const paymentStatus = payload.status;

  // Log the webhook payload
  console.log('Webhook flutterwave payload:', payload);

  // 2. We are only interested in successful card transactions
  if (event === 'CARD_TRANSACTION' && paymentStatus === 'successful') {
    try {
      // Best practice: Re-verify the transaction status with Flutterwave API
      const flutterwaveApi = getFlutterwaveApi();
      const flwTransactionId = payload.id;
      const flwResponse = await flutterwaveApi.get(`/transactions/${flwTransactionId}/verify`);
      const flwTransaction = flwResponse.data.data;

      if (flwTransaction && flwTransaction.status === 'successful') {
        // Extract Sharetribe transaction ID from tx_ref (format: {sharetribeTxId}_{timestamp})
        const sharetribeTransactionId = flwTransaction.tx_ref.split('_')[0];
        const integrationSdk = getIntegrationSdk();

        // 3. Confirm the payment in Sharetribe
        await confirmPayment(integrationSdk, sharetribeTransactionId, flwTransactionId);

        //4. Update metadata in Sharetribe transaction
        await integrationSdk.transactions.updateMetadata({
          id: sharetribeTransactionId,
          metadata: {
            flutterwaveTransactionId: String(flwTransactionId),
            flutterwaveStatus: flwTransaction.status,
          },
        });
      }
    } catch (error) {
      console.error('Webhook: Error processing Flutterwave event:', error.message);
    }
  }

  // Always acknowledge receipt to Flutterwave
  res.status(200).send('Webhook received');
};

module.exports = webhook;
