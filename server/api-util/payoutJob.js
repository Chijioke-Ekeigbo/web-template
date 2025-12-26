const cron = require('node-cron');
const { getFlutterwaveApi } = require('./flutterwaveSdk');
const { getIntegrationSdk } = require('./sdk');
const { denormalisedResponseEntities } = require('./format');

/**
 * Worker to process payouts for completed transactions via Flutterwave.
 */
const fromToday = new Date('2025-12-25T15:40:00Z');
const processPayouts = async () => {
  console.log('PayoutWorker: Checking for completed transactions needing payout...');
  console.log('--------------------------------------------------');

  try {
    const integrationSdk = getIntegrationSdk();
    const flutterwaveApi = getFlutterwaveApi();

    // 1. Query completed transactions
    // We filter for transactions in 'state/completed' that don't have a transferId in metadata
    const txResponse = await integrationSdk.transactions.query({
      states: ['state/completed'],
      include: ['provider'],
      // We'll filter for those without transferId manually in the code
      // as metadata filtering in query is limited.
      createdAtStart: fromToday.toISOString(),
    });

    const transactions = denormalisedResponseEntities(txResponse);

    // Filter for transactions that haven't been processed yet or have failed
    const pendingPayouts = transactions
      .filter(tx => {
        const metadata = tx.attributes.metadata;
        const hasNoTransfer = !metadata?.transferId;
        const isFailed = metadata?.transferStatus === 'FAILED';
        return hasNoTransfer || isFailed;
      })
      // Sort oldest to newest based on last transition
      .sort(
        (a, b) =>
          new Date(a.attributes.lastTransitionedAt) - new Date(b.attributes.lastTransitionedAt)
      );

    if (pendingPayouts.length === 0) {
      console.log('PayoutWorker: No pending payouts found.');
      console.log('--------------------------------------------------');
      return;
    }

    console.log(`PayoutWorker: Found ${pendingPayouts.length} transactions pending payout.`);
    console.log('');

    // 2. Process each payout
    for (const tx of pendingPayouts) {
      const txId = tx.id.uuid;
      const provider = tx.provider;
      const payoutTotal = tx.attributes.payoutTotal;
      const currency = payoutTotal.currency;
      const amount = payoutTotal.amount / 100; // Flutterwave major units
      const metadata = tx.attributes.metadata || {};
      const existingTransferId = metadata.transferId;
      const isRetry = existingTransferId && metadata.transferStatus !== 'SUCCESSFUL';

      console.log(
        `PayoutWorker: Processing ${
          isRetry ? 'retry' : 'payout'
        } for transaction ${txId} (${amount} ${currency})`
      );
      console.log('');

      try {
        // a. Check Flutterwave balance for this currency
        const { data: balanceResponse } = await flutterwaveApi.get(`/balances/${currency}`);
        const availableBalance = balanceResponse.data.available_balance;
        if (availableBalance < amount) {
          console.warn(
            `PayoutWorker: Insufficient balance for ${currency}. Available: ${availableBalance}, Required: ${amount}`
          );
          console.warn('');
          continue; // Skip this one for now, maybe next run has more balance
        }

        // b. Get provider payout details
        const flwSubaccount = provider.attributes.profile.privateData?.flutterwaveSubaccount;
        if (!flwSubaccount || !flwSubaccount.accountBank || !flwSubaccount.accountNumber) {
          throw new Error('Provider payout details missing or incomplete.');
        }

        let transferResponse;
        if (isRetry && existingTransferId) {
          // c1. Retry failed transfer
          // Documentation: POST /transfers/{id}/retries
          console.log(`PayoutWorker: Retrying failed transfer ${existingTransferId}`);
          console.log('');
          transferResponse = await flutterwaveApi.post(
            `/transfers/${existingTransferId}/retries`,
            {}
          );
        } else if (!existingTransferId) {
          // c2. Create new Flutterwave transfer
          const transferPayload = {
            account_bank: flwSubaccount.accountBank,
            account_number: flwSubaccount.accountNumber,
            amount: amount,
            currency: currency,
            narration: `Payout for transaction ${txId}`,
            reference: `payout_${txId}_${Date.now()}`,
            callback_url: `${process.env.REACT_APP_MARKETPLACE_ROOT_URL}/api/payments/payout-webhook`,
            debit_currency: currency,
          };

          transferResponse = await flutterwaveApi.post('/transfers', transferPayload, {});
        }

        const transferData = transferResponse.data.data;

        // d. Update Sharetribe transaction metadata
        const metadataUpdate = {
          transferStatus: transferData.status,
          transferProcessedAt: new Date().toISOString(),
        };

        // ONLY save transferId on the first creation (not on retries)
        if (!isRetry) {
          metadataUpdate.transferId = String(transferData.id);
        }

        await integrationSdk.transactions.updateMetadata({
          id: tx.id,
          metadata: metadataUpdate,
        });

        console.log(
          `PayoutWorker: Successfully ${
            isRetry ? 'retried' : 'initiated'
          } payout for ${txId}. FLW Transfer ID: ${transferData.id}`
        );
        console.log('');
      } catch (err) {
        console.error(`PayoutWorker: Failed to process payout for ${txId}:`, err.message);
        console.error('');

        // e. Save error to transaction data for tracking
        try {
          await integrationSdk.transactions.updateMetadata({
            id: tx.id,
            metadata: {
              payoutErrorLogs: [
                ...(tx.attributes.metadata?.payoutErrorLogs || []),
                {
                  date: new Date().toISOString(),
                  error: err.message,
                },
              ],
            },
          });
        } catch (metaErr) {
          console.error(
            `PayoutWorker: Failed to update error metadata for ${txId}:`,
            metaErr.message
          );
          console.error('');
        }
      }
    }

    console.log('PayoutWorker: Finished processing pending payouts.');
    console.log('--------------------------------------------------');
  } catch (error) {
    console.error('PayoutWorker: Critical error in payout process:', error.message);
    console.error('--------------------------------------------------');
  }
};

/**
 * Start the payout worker with a specific cron schedule.
 * Default is every hour: '0 * * * *'
 */
const startPayoutWorker = (cronExpression = '0 * * * *') => {
  console.log(`PayoutWorker: Starting payout worker (schedule: ${cronExpression})`);
  console.log('--------------------------------------------------');

  // Run immediately on start (optional, but usually helpful for development/debugging)
  processPayouts();

  // Schedule subsequent runs using node-cron
  cron.schedule(cronExpression, () => {
    processPayouts();
  });
};

module.exports = {
  startPayoutWorker,
  processPayouts,
};
