const cron = require('node-cron');
const { getFlutterwaveApi } = require('../api-util/flutterwaveSdk');
const { getIntegrationSdk } = require('../api-util/sdk');
const { denormalisedResponseEntities } = require('../api-util/format');

const fromToday = new Date('2025-12-26T06:59:00Z');

/**
 * Worker to process refunds for expired or cancelled transactions via Flutterwave.
 *
 * This job:
 * 1. Queries all 'state/payment-expired' and 'state/canceled' transactions.
 * 2. Filters for those needing a refund (new or previously failed).
 * 3. Handles Flutterwave refunds.
 * 4. Updates Sharetribe metadata with results and 'refunded' status.
 */

const PER_PAGE = 100;
const queryAllPagesTransactions = async integrationSdk => {
  let page = 1;
  let totalPages = 1;
  const transactions = [];
  do {
    const txResponse = await integrationSdk.transactions.query({
      states: ['state/payment-expired', 'state/canceled'],
      createdAtStart: fromToday.toISOString(),
      page,
      perPage: PER_PAGE,
    });
    const newTransactions = denormalisedResponseEntities(txResponse);
    transactions.push(...newTransactions);
    totalPages = txResponse.data.meta.totalPages;
    page++;
  } while (page <= totalPages);
  return transactions;
};

const processRefunds = async () => {
  console.log('RefundWorker: Checking for expired or cancelled transactions needing refund...');
  console.log('--------------------------------------------------');

  try {
    const integrationSdk = getIntegrationSdk();
    const flutterwaveApi = getFlutterwaveApi();

    const allTransactions = await queryAllPagesTransactions(integrationSdk);

    // --- STEP 2: FILTER ---
    // Filter for transactions that have a Flutterwave transaction ID but haven't been successfully refunded yet
    const pendingRefunds = allTransactions.filter(tx => {
      const metadata = tx.attributes.metadata || {};
      // Skip if already successfully handled
      if (metadata.refunded === true) return false;

      const { flutterwaveTransactionId, refundId, refundStatus } = metadata;

      const hasFlwId = !!flutterwaveTransactionId;
      const isNew = !refundId;
      const isFailed = refundStatus === 'FAILED' || refundStatus === 'failed';

      return hasFlwId && (isNew || isFailed);
    });

    if (pendingRefunds.length === 0) {
      console.log('RefundWorker: No pending refunds found.');
      console.log('--------------------------------------------------');
      return;
    }

    console.log(`RefundWorker: Found ${pendingRefunds.length} transactions pending refund.`);
    console.log('');

    // --- STEP 3: PROCESS EACH TRANSACTION ---
    for (const tx of pendingRefunds) {
      const txId = tx.id.uuid;
      const metadata = tx.attributes.metadata || {};
      const flwTransactionId = metadata.flutterwaveTransactionId;

      console.log(
        `RefundWorker: Initiating refund for transaction ${txId} (FLW: ${flwTransactionId})`
      );

      try {
        // a. Create Flutterwave refund
        const fullAmount = tx.attributes.payinTotal.amount / 100;
        const refundResponse = await flutterwaveApi.post(
          `/transactions/${flwTransactionId}/refund`,
          {
            amount: fullAmount,
            comment: `Refund for transaction ${txId}`,
          }
        );

        const refundData = refundResponse.data.data;
        const status = refundData.status; // e.g. 'completed' or 'pending' or 'failed'
        const isSuccessfulOrPending = status !== 'failed'; // Flutterwave uses lowercase status for refunds

        // b. Update Sharetribe transaction metadata
        await integrationSdk.transactions.updateMetadata({
          id: tx.id,
          metadata: {
            refunded: isSuccessfulOrPending,
            refundId: String(refundData.id),
            refundStatus: status,
            refundProcessedAt: new Date().toISOString(),
          },
        });

        console.log(`RefundWorker: Refund ${status} for ${txId}. Refund ID: ${refundData.id}`);
      } catch (err) {
        console.error(`RefundWorker: Failed for ${txId}:`, err.message);

        // c. Log error to transaction metadata
        try {
          const currentLogs = metadata.refundErrorLogs || [];
          await integrationSdk.transactions.updateMetadata({
            id: tx.id,
            metadata: {
              refundErrorLogs: [
                ...currentLogs,
                { date: new Date().toISOString(), error: err.message },
              ],
              refundStatus: 'failed',
            },
          });
        } catch (metaErr) {
          console.error(`RefundWorker: Error log failed for ${txId}:`, metaErr.message);
        }
      }
      console.log('');
    }

    console.log('RefundWorker: Finished processing all pending refunds.');
    console.log('--------------------------------------------------');
  } catch (error) {
    console.error('RefundWorker: Critical error in refund process:', error.message);
    console.log('--------------------------------------------------');
  }
};

/**
 * Start the refund worker with a specific cron schedule.
 */
const startRefundWorker = (cronExpression = '30 * * * *') => {
  console.log(`RefundWorker: Starting refund worker (schedule: ${cronExpression})`);
  console.log('--------------------------------------------------');

  // Schedule subsequent runs using node-cron
  cron.schedule(cronExpression, () => {
    processRefunds();
  });
};

module.exports = {
  startRefundWorker,
  processRefunds,
};
