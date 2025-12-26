const cron = require('node-cron');
const { getFlutterwaveApi } = require('./flutterwaveSdk');
const { getIntegrationSdk } = require('./sdk');
const { denormalisedResponseEntities } = require('./format');

/**
 * Worker to process refunds for expired or cancelled transactions via Flutterwave.
 */

const fromToday = new Date('2025-12-25T15:40:00Z');
const processRefunds = async () => {
  console.log('RefundWorker: Checking for expired or cancelled transactions needing refund...');
  console.log('--------------------------------------------------');

  try {
    const integrationSdk = getIntegrationSdk();
    const flutterwaveApi = getFlutterwaveApi();

    // 1. Query expired or cancelled transactions
    // We filter for transactions in 'state/payment-expired' or 'state/canceled'
    const txResponse = await integrationSdk.transactions.query({
      states: ['state/payment-expired', 'state/canceled'],
      meta_refunded: false,
      createdAtStart: fromToday.toISOString(),
    });

    const transactions = denormalisedResponseEntities(txResponse);
    // Filter for transactions that have a Flutterwave transaction ID but haven't been refunded yet
    const pendingRefunds = transactions.filter(tx => {
      const metadata = tx.attributes.metadata || {};
      const flwTransactionId = metadata.flutterwaveTransactionId;
      const hasNoRefund = !metadata.refundId;
      const isFailed = metadata.refundStatus === 'FAILED';
      return flwTransactionId && (hasNoRefund || isFailed);
    });

    if (pendingRefunds.length === 0) {
      console.log('RefundWorker: No pending refunds found.');
      console.log('--------------------------------------------------');
      return;
    }

    console.log(`RefundWorker: Found ${pendingRefunds.length} transactions pending refund.`);
    console.log('');

    for (const tx of pendingRefunds) {
      const txId = tx.id.uuid;
      const metadata = tx.attributes.metadata || {};
      const flwTransactionId = metadata.flutterwaveTransactionId;

      console.log(
        `RefundWorker: Initiating refund for transaction ${txId} (FLW: ${flwTransactionId})`
      );
      console.log('');

      try {
        // 2. Create Flutterwave refund
        // Endpoint: POST /transactions/{id}/refund
        // According to FLW docs: https://developer.flutterwave.com/v3.0.0/reference/transaction-refund
        const fullAmount = tx.attributes.payinTotal.amount / 100;
        const refundResponse = await flutterwaveApi.post(
          `/transactions/${flwTransactionId}/refund`,
          {
            amount: fullAmount, // Full refund
            comment: `Refund for transaction ${txId}`,
          }
        );
        const refundData = refundResponse.data.data;

        // 3. Update Sharetribe transaction metadata
        await integrationSdk.transactions.updateMetadata({
          id: tx.id,
          metadata: {
            refunded: true,
            refundId: String(refundData.id),
            refundStatus: refundData.status,
            refundProcessedAt: new Date().toISOString(),
          },
        });

        console.log(
          `RefundWorker: Successfully refunded transaction ${txId}. Refund ID: ${refundData.id}`
        );
        console.log('');
      } catch (err) {
        console.error(
          `RefundWorker: Failed to refund transaction ${txId}:`,
          JSON.stringify(err, null, 2)
        );
        console.error('');

        // Log error to transaction metadata
        try {
          const currentLogs = metadata.refundErrorLogs || [];
          await integrationSdk.transactions.updateMetadata({
            id: tx.id,
            metadata: {
              refundErrorLogs: [
                ...currentLogs,
                {
                  date: new Date().toISOString(),
                  error: err.message,
                },
              ],
              refundStatus: 'failed',
            },
          });
        } catch (metaErr) {
          console.error(
            `RefundWorker: Failed to update error metadata for ${txId}:`,
            metaErr.message
          );
          console.error('');
        }
      }
    }

    console.log('RefundWorker: Finished processing pending refunds.');
    console.log('--------------------------------------------------');
  } catch (error) {
    console.error('RefundWorker: Critical error in refund process:', error.message);
    console.error('--------------------------------------------------');
  }
};

/**
 * Start the refund worker with a specific cron schedule.
 * Default is every hour: '30 * * * *' (offset by 30 mins from payout job)
 */
const startRefundWorker = (cronExpression = '30 * * * *') => {
  console.log(`RefundWorker: Starting refund worker (schedule: ${cronExpression})`);
  console.log('--------------------------------------------------');

  // Run immediately on start
  processRefunds();

  // Schedule subsequent runs using node-cron
  cron.schedule(cronExpression, () => {
    processRefunds();
  });
};

module.exports = {
  startRefundWorker,
  processRefunds,
};
