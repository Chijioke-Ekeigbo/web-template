// Import contexts and util modules
import { findRouteByRouteName } from '../../util/routes';
import { ensureTransaction } from '../../util/data';
import { minutesBetween } from '../../util/dates';
import { formatMoney } from '../../util/currency';
import { NEGOTIATION_PROCESS_NAME, resolveLatestProcessName } from '../../transactions/transaction';
import { storeData } from './CheckoutPageSessionHelpers';

/**
 * Extract relevant transaction type data from listing type
 * Note: this is saved to protectedData of the transaction entity
 *       therefore, we don't need the process name (nor alias)
 *
 * @param {Object} listingType
 * @param {String} unitTypeInPublicData
 * @param {Object} config
 * @returns object containing unitType etc. - or an empty object.
 */
export const getTransactionTypeData = (listingType, unitTypeInPublicData, config) => {
  const listingTypeConfig = config.listing.listingTypes.find(lt => lt.listingType === listingType);
  const { process, alias, unitType, ...rest } = listingTypeConfig?.transactionType || {};
  // Note: we want to rely on unitType written in public data of the listing entity.
  //       The listingType configuration might have changed on the fly.
  return unitTypeInPublicData ? { unitType: unitTypeInPublicData, ...rest } : {};
};

/**
 * This just makes it easier to transfrom bookingDates object if needed
 * (or manibulate bookingStart and bookingEnd)
 *
 * @param {Object} bookingDates
 * @returns object containing bookingDates or an empty object.
 */
export const bookingDatesMaybe = bookingDates => {
  return bookingDates ? { bookingDates } : {};
};

/**
 * Get formatted total price (payinTotal)
 *
 * @param {Object} transaction
 * @param {Object} intl
 * @returns formatted money as a string.
 */
export const getFormattedTotalPrice = (transaction, intl) => {
  const totalPrice = transaction.attributes.payinTotal;
  return formatMoney(intl, totalPrice);
};

/**
 * Construct shipping details (JSON-like object)
 *
 * @param {Object} formValues object containing saveAfterOnetimePayment, recipientName,
 * recipientPhoneNumber, recipientAddressLine1, recipientAddressLine2, recipientPostal,
 * recipientCity, recipientState, and recipientCountry.
 * @returns shippingDetails object containing name, phoneNumber and address
 */
export const getShippingDetailsMaybe = formValues => {
  const {
    saveAfterOnetimePayment: saveAfterOnetimePaymentRaw,
    recipientName,
    recipientPhoneNumber,
    recipientAddressLine1,
    recipientAddressLine2,
    recipientPostal,
    recipientCity,
    recipientState,
    recipientCountry,
  } = formValues;

  return recipientName && recipientAddressLine1 && recipientPostal
    ? {
        shippingDetails: {
          name: recipientName,
          phoneNumber: recipientPhoneNumber,
          address: {
            city: recipientCity,
            country: recipientCountry,
            line1: recipientAddressLine1,
            line2: recipientAddressLine2,
            postalCode: recipientPostal,
            state: recipientState,
          },
        },
      }
    : {};
};

/**
 * Check if payment is expired (PAYMENT_EXPIRED state) or if payment has passed 15 minute treshold from PENDING_PAYMENT
 *
 * @param {Object} existingTransaction
 * @param {Object} process
 * @returns true if payment has expired.
 */
export const hasPaymentExpired = (existingTransaction, process, isClockInSync) => {
  const state = process.getState(existingTransaction);
  return state === process.states.PAYMENT_EXPIRED
    ? true
    : state === process.states.PENDING_PAYMENT && isClockInSync
    ? minutesBetween(existingTransaction.attributes.lastTransitionedAt, new Date()) >= 15
    : false;
};

/**
 * Check if the transaction has passed PENDING_PAYMENT state (assumes that process has that state)
 * @param {Object} tx
 * @param {Object} process
 * @returns true if the transaction has passed that state
 */
export const hasTransactionPassedPendingPayment = (tx, process) => {
  return process.hasPassedState(process.states.PENDING_PAYMENT, tx);
};

export const hasTransactionPassedPurchased = (tx, process) => {
  return process.hasPassedState(process.states.PURCHASED, tx);
};

export const persistTransaction = (order, pageData, storeData, setPageData, sessionStorageKey) => {
  // Store the returned transaction (order)
  if (order?.id) {
    // Store order.
    const { orderData, listing } = pageData;
    storeData(orderData, listing, { ...order, initiated: true }, sessionStorageKey);
    setPageData({ ...pageData, transaction: { ...order, initiated: true } });
  }
};

/**
 * Create call sequence for checkout with Flutterwave Standard Checkout.
 *
 * @param {Object} orderParams contains params for the initial order itself
 * @param {Object} extraPaymentParams contains extra params needed by one of the following calls in the checkout sequence
 * @returns Promise that goes through each step in the checkout sequence.
 */
export const processCheckoutWithFlutterwave = (orderParams, extraPaymentParams) => {
  const {
    onInitiateOrder,
    pageData,
    process,
    setPageData,
    sessionStorageKey,
    onCreateFlutterwaveCheckout,
  } = extraPaymentParams;
  const storedTx = ensureTransaction(pageData.transaction);
  const processAlias = pageData?.listing?.attributes?.publicData?.transactionProcessAlias;

  // Step 1: initiate order
  const fnRequestPayment = fnParams => {
    const isOfferPendingInNegotiationProcess =
      resolveLatestProcessName(processAlias.split('/')[0]) === NEGOTIATION_PROCESS_NAME &&
      storedTx.attributes.state === `state/${process.states.OFFER_PENDING}`;
    const isJustInquiry = storedTx?.attributes?.lastTransition === process.transitions.INQUIRE;
    const requestTransition = isJustInquiry
      ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
      : isOfferPendingInNegotiationProcess
      ? process.transitions.REQUEST_PAYMENT_TO_ACCEPT_OFFER
      : process.transitions.REQUEST_PAYMENT;
    const isPrivileged = process.isPrivileged(requestTransition);

    const orderPromise =
      !isJustInquiry && storedTx.id
        ? Promise.resolve(storedTx)
        : onInitiateOrder(fnParams, processAlias, storedTx.id, requestTransition, isPrivileged);

    orderPromise.then(order => {
      persistTransaction(order, pageData, storeData, setPageData, sessionStorageKey);
    });

    return orderPromise;
  };

  // Step 2: create Flutterwave checkout link
  const fnCreateFlutterwaveCheckout = fnParams => {
    const order = fnParams;
    return onCreateFlutterwaveCheckout(order.id).then(response => {
      return { ...fnParams, checkoutLink: response.link };
    });
  };

  // Step 3: redirect to Flutterwave checkout link
  const fnRedirectToFlutterwaveCheckout = fnParams => {
    const { checkoutLink } = fnParams;
    window.location.href = checkoutLink;
  };

  const applyAsync = (acc, val) => acc.then(val);
  const composeAsync = (...funcs) => x => funcs.reduce(applyAsync, Promise.resolve(x));
  const handleCheckoutCreation = composeAsync(
    fnRequestPayment,
    fnCreateFlutterwaveCheckout,
    fnRedirectToFlutterwaveCheckout
  );

  return handleCheckoutCreation(orderParams);
};

/**
 * Initialize OrderDetailsPage with given initialValues.
 *
 * @param {Object} initialValues
 * @param {Object} routes
 * @param {Function} dispatch
 */
export const setOrderPageInitialValues = (initialValues, routes, dispatch) => {
  const OrderPage = findRouteByRouteName('OrderDetailsPage', routes);

  // Transaction is already created, but if the initial message
  // sending failed, we tell it to the OrderDetailsPage.
  dispatch(OrderPage.setInitialValues(initialValues));
};
