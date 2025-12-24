const { getFlutterwaveApi } = require('../../api-util/flutterwaveSdk');
const { denormalisedResponseEntities } = require('../../api-util/format');
const { serialize, handleError, getTrustedSdk, getIntegrationSdk } = require('../../api-util/sdk');
const createSlugFromString = str => {
  return str
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^\w-]+/g, '');
};
const createCheckout = async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      const error = new Error('Transaction ID is required');
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = { message: 'Transaction ID is required' };
      throw error;
    }

    // Use trusted SDK to fetch transaction and provider's privateData
    const trustedSdk = await getTrustedSdk(req);
    const txResponse = await trustedSdk.transactions.show(
      {
        id: transactionId,
        include: ['listing', 'listing.author', 'provider'],
      },
      {
        expand: true,
      }
    );

    const [tx] = denormalisedResponseEntities(txResponse);
    const integrationSdk = getIntegrationSdk();

    const { provider: providerFromTx } = tx;
    const providerResponse = await integrationSdk.users.show({
      id: providerFromTx?.id?.uuid,
    });

    const [provider] = denormalisedResponseEntities(providerResponse);

    const payinTotal = tx.attributes.payinTotal;
    // Flutterwave expects amount in major units (e.g., Naira, Dollars)
    const amount = payinTotal.amount / 100;
    const currency = payinTotal.currency;

    if (!provider) {
      const error = new Error('Provider not found for this transaction');
      error.status = 404;
      error.statusText = 'Not Found';
      throw error;
    }

    const flutterwaveSubaccount = provider.attributes.profile.privateData?.flutterwaveSubaccount;
    const subaccountId = flutterwaveSubaccount?.subaccountId;

    if (!subaccountId) {
      const error = new Error('Provider has not set up payout details');
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = { message: 'Provider has not set up payout details' };
      throw error;
    }

    const rootUrl = process.env.REACT_APP_MARKETPLACE_ROOT_URL;
    const listingSlug = createSlugFromString(tx.listing.attributes.title);
    const listingId = tx.listing.id.uuid;
    const flutterwaveApi = getFlutterwaveApi();
    const txRef = `${transactionId.uuid}-${new Date().getTime()}`;

    const payload = {
      tx_ref: txRef,
      amount,
      currency,
      redirect_url: `${rootUrl}/l/${listingSlug}/${listingId}/checkout`,
      customer: {
        email: req.currentUser.attributes.email,
        name: `${req.currentUser.attributes.profile.firstName} ${req.currentUser.attributes.profile.lastName}`,
      },
      subaccounts: [
        {
          id: subaccountId,
        },
      ],
      customizations: {
        title: process.env.REACT_APP_MARKETPLACE_NAME || 'Marketplace Payment',
      },
    };

    const response = await flutterwaveApi.post('/payments', payload);

    return res
      .status(200)
      .set('Content-Type', 'application/transit+json')
      .send(
        serialize({
          status: 200,
          statusText: 'OK',
          data: response.data.data,
        })
      )
      .end();
  } catch (error) {
    handleError(res, error);
  }
};

module.exports = createCheckout;
