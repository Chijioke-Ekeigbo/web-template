const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const {
  addOfferToMetadata,
  getAmountFromPreviousOffer,
  isIntentionToMakeCounterOffer,
  isIntentionToMakeOffer,
  isIntentionToRevokeCounterOffer,
  throwErrorIfNegotiationOfferHasInvalidHistory,
} = require('../api-util/negotiation');
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

const transactionPromise = (sdk, id) =>
  sdk.transactions.show({ id, include: ['listing', 'provider'] });

const getFullOrderData = (orderData, bodyParams, currency, offers) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;
  const orderDataAndParams = { ...orderData, ...bodyParams.params, currency };

  return isIntentionToMakeOffer(offerInSubunits, transitionName) ||
    isIntentionToMakeCounterOffer(offerInSubunits, transitionName)
    ? {
        ...orderDataAndParams,
        offer: new Money(offerInSubunits, currency),
      }
    : isIntentionToRevokeCounterOffer(transitionName)
    ? {
        ...orderDataAndParams,
        offer: new Money(getAmountFromPreviousOffer(offers), currency),
      }
    : orderDataAndParams;
};

const getUpdatedMetadata = (orderData, transition, existingMetadata) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for default-negotiation process, the actor is always "provider" when making an offer.
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  const isNewOffer =
    isIntentionToMakeOffer(offerInSubunits, transition) ||
    isIntentionToMakeCounterOffer(offerInSubunits, transition);

  return isNewOffer
    ? addOfferToMetadata(existingMetadata, {
        offerInSubunits,
        by,
        transition,
      })
    : isIntentionToRevokeCounterOffer(transition)
    ? addOfferToMetadata(existingMetadata, {
        offerInSubunits: getAmountFromPreviousOffer(existingMetadata.offers),
        by,
        transition,
      })
    : addOfferToMetadata(existingMetadata, null);
};

module.exports = async (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body;

  const sdk = getSdk(req, res);
  const integrationSdk = getIntegrationSdk();
  const transitionName = bodyParams.transition;

  try {
    const [showTransactionResponse, fetchAssetsResponse] = await Promise.all([
      transactionPromise(sdk, bodyParams?.id),
      fetchCommission(sdk),
    ]);

    const [transaction] = denormalisedResponseEntities(showTransactionResponse);
    const listing = transaction.listing;
    const providerResponse = await integrationSdk.users.show({
      id: transaction.provider.id.uuid,
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

    const commissionAsset = fetchAssetsResponse.data.data[0];

    const existingMetadata = transaction?.attributes?.metadata;
    const existingOffers = existingMetadata?.offers || [];
    const transitions = transaction.attributes.transitions;

    // Check if the transition is related to negotiation offers and if the offers are valid
    throwErrorIfNegotiationOfferHasInvalidHistory(transitionName, existingOffers, transitions);

    const currency =
      transaction.attributes.payinTotal?.currency ||
      listing.attributes.price?.currency ||
      orderData.currency;
    const { providerCommission, customerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

    const lineItems = transactionLineItems(
      listing,
      getFullOrderData(orderData, bodyParams, currency, existingOffers),
      providerCommission,
      customerCommission
    );

    const metadataMaybe = getUpdatedMetadata(orderData, transitionName, existingMetadata);

    const trustedSdk = await getTrustedSdk(req);
    // Omit listingId from params (transition/request-payment-after-inquiry does not need it)
    const { listingId, ...restParams } = bodyParams?.params || {};

    // Add lineItems to the body params
    const body = {
      ...bodyParams,
      params: {
        ...restParams,
        lineItems,
        ...metadataMaybe,
      },
    };

    const apiResponse = isSpeculative
      ? await trustedSdk.transactions.transitionSpeculative(body, queryParams)
      : await trustedSdk.transactions.transition(body, queryParams);

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
