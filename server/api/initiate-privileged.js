const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
  getIntegrationSdk,
} = require('../api-util/sdk');
const { denormalisedResponseEntities } = require('../api-util/format');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id, include: ['author'] });

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for now, the actor is always "provider".
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

module.exports = async (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body;
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  const integrationSdk = getIntegrationSdk();

  try {
    const [showListingResponse, fetchAssetsResponse] = await Promise.all([
      listingPromise(sdk, bodyParams?.params?.listingId),
      fetchCommission(sdk),
    ]);

    const [listing] = denormalisedResponseEntities(showListingResponse);
    const commissionAsset = fetchAssetsResponse.data.data[0];
    const providerResponse = await integrationSdk.users.show({
      id: listing.author.id.uuid,
    });
    const [provider] = denormalisedResponseEntities(providerResponse);

    const flutterwaveSubaccount = provider.attributes.profile.privateData?.flutterwaveSubaccount;

    if (!flutterwaveSubaccount) {
      const error = new Error('Provider has not set up payout details');
      error.status = 400;
      error.statusText = 'Bad Request';
      error.code = 'transaction-missing-stripe-account';
      error.data = {
        errors: [
          {
            id: 'transaction-missing-stripe-account',
            status: 400,
            title: 'Provider has not set up payout details',
            code: 'transaction-missing-stripe-account',
          },
        ],
      };

      throw error;
    }

    const currency = listing.attributes.price?.currency || orderData.currency;
    const { providerCommission, customerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

    const lineItems = transactionLineItems(
      listing,
      getFullOrderData(orderData, bodyParams, currency),
      providerCommission,
      customerCommission
    );
    const metadataMaybe = getMetadata(orderData, transitionName);

    const trustedSdk = await getTrustedSdk(req);
    const { params } = bodyParams;

    // Add lineItems to the body params
    const body = {
      ...bodyParams,
      params: {
        ...params,
        lineItems,
        ...metadataMaybe,
      },
    };

    const apiResponse = isSpeculative
      ? await trustedSdk.transactions.initiateSpeculative(body, queryParams)
      : await trustedSdk.transactions.initiate(body, queryParams);

    const { status, statusText, data } = apiResponse;
    res
      .status(status)
      .set('Content-Type', 'application/transit+json')
      .send(
        serialize({
          status,
          statusText,
          data,
        })
      )
      .end();
  } catch (e) {
    handleError(res, e);
  }
};
