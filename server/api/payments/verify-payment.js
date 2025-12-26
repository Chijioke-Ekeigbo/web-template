const { getFlutterwaveApi } = require('../../api-util/flutterwaveSdk');
const { denormalisedResponseEntities } = require('../../api-util/format');
const { serialize, handleError, getIntegrationSdk } = require('../../api-util/sdk');

/**
 * Verify Flutterwave transaction status.
 * This endpoint is called from the frontend after a successful redirect from Flutterwave Standard Checkout.
 */
const verifyPayment = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      const error = new Error('Flutterwave transaction ID is required');
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = { message: 'Flutterwave transaction ID is required' };
      throw error;
    }

    const flutterwaveApi = getFlutterwaveApi();
    const response = await flutterwaveApi.get(`/transactions/${id}/verify`);
    const transaction = response.data.data;

    const sharetribeTransactionId = transaction.tx_ref?.split('_')?.[0];
    const integrationSdk = getIntegrationSdk(req);

    const txResponse = await integrationSdk.transactions.show(
      {
        id: sharetribeTransactionId,
        include: ['booking', 'provider'],
      },
      {
        expand: true,
      }
    );
    const [tx] = denormalisedResponseEntities(txResponse);

    const payInTotal = tx.attributes.payinTotal;
    const expectedAmount = payInTotal.amount / 100;
    const expectedCurrency = payInTotal.currency;

    if (transaction.amount !== expectedAmount || transaction.currency !== expectedCurrency) {
      const error = new Error(
        `Transaction amount or currency does not match. Expected ${expectedAmount} ${expectedCurrency}, got ${transaction.amount} ${transaction.currency}`
      );
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = {
        message: `Transaction amount or currency does not match. Expected ${expectedAmount} ${expectedCurrency}, got ${transaction.amount} ${transaction.currency}`,
      };
      throw error;
    }

    // We proceed if the transaction status is 'successful' or 'pending'
    if (transaction.status === 'successful' || transaction.status === 'pending') {
      return res
        .status(200)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status: 200,
            statusText: 'OK',
            data: {
              ...transaction,
              sharetribeTransaction: tx,
            },
          })
        )
        .end();
    } else {
      const error = new Error(`Transaction verification failed. Status: ${transaction.status}`);
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = {
        message: `Transaction verification failed. Status: ${transaction.status}`,
        transaction,
      };
      throw error;
    }
  } catch (error) {
    handleError(res, error);
  }
};

module.exports = verifyPayment;
