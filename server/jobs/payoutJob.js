const cron = require('node-cron');
const { getFlutterwaveApi } = require('../api-util/flutterwaveSdk');
const { getIntegrationSdk } = require('../api-util/sdk');
const { denormalisedResponseEntities } = require('../api-util/format');

const fromToday = new Date('2025-12-26T07:14:00Z');
const PER_PAGE = 100;
const queryAllPagesTransactions = async integrationSdk => {
  let page = 1;
  let totalPages = 1;
  const transactions = [];
  do {
    const txResponse = await integrationSdk.transactions.query({
      states: ['state/completed'],
      createdAtStart: fromToday.toISOString(),
      page,
      perPage: PER_PAGE,
      meta_transferred: false,
      include: ['provider'],
    });
    const newTransactions = denormalisedResponseEntities(txResponse);
    transactions.push(...newTransactions);
    totalPages = txResponse.data.meta.totalPages;
    page++;
  } while (page <= totalPages);

  return transactions;
};

/**
 * Worker to process payouts for completed transactions via Flutterwave.
 */
let isProcessing = false;
const processPayouts = async () => {
  if (isProcessing) {
    console.log('PayoutWorker: Job is already running. Skipping this run.');
    return;
  }

  isProcessing = true;
  console.log('PayoutWorker: Checking for completed transactions needing payout...');
  console.log('--------------------------------------------------');

  try {
    const integrationSdk = getIntegrationSdk();
    const flutterwaveApi = getFlutterwaveApi();

    // 1. Query completed transactions
    // We filter for transactions in 'state/completed' that don't have a transferId in metadata
    const transactions = await queryAllPagesTransactions(integrationSdk);
    // Filter for transactions that haven't been processed yet or have failed
    const pendingPayouts = transactions
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
      let isRetry = false;
      try {
        if (existingTransferId) {
          const lastestTransferData = await flutterwaveApi.get(`/transfers/${existingTransferId}`);
          const lastestTransferStatus = lastestTransferData.data.data.status;
          if (lastestTransferStatus === 'SUCCESSFUL' || lastestTransferStatus === 'PENDING') {
            console.log(`PayoutWorker: Transfer ${existingTransferId} is already processed.`);
            console.log('');

            await integrationSdk.transactions.updateMetadata({
              id: tx.id,
              metadata: { transferStatus: lastestTransferStatus, transferred: true },
            });

            continue;
          }
          isRetry = lastestTransferStatus === 'FAILED';
        }

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
            callback_url: `${process.env.REACT_APP_MARKETPLACE_ROOT_URL}/api/payments/payout-webhook`,
            debit_currency: currency,
            //this would help there is no duplicate payout for the same transaction
            //if payout is already initiated, it will be skipped
            reference: `payout_${txId}`,
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
  } finally {
    isProcessing = false;
  }
};

/**
 * Start the payout worker with a specific cron schedule.
 * Default is every hour: '0 * * * *'
 */
const startPayoutWorker = (cronExpression = '0 * * * *') => {
  console.log(`PayoutWorker: Starting payout worker (schedule: ${cronExpression})`);
  console.log('--------------------------------------------------');

  // Schedule subsequent runs using node-cron
  cron.schedule(cronExpression, () => {
    processPayouts();
  });
};

module.exports = {
  startPayoutWorker,
  processPayouts,
};
