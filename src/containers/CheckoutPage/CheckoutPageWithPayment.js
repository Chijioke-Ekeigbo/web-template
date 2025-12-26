import React, { useEffect, useState } from 'react';

// Import contexts and util modules
import { FormattedMessage } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { ensureTransaction } from '../../util/data';
import { createSlug } from '../../util/urlHelpers';
import { isTransactionInitiateListingNotFoundError } from '../../util/errors';

import {
  getProcess,
  resolveLatestProcessName,
  BOOKING_PROCESS_NAME,
  NEGOTIATION_PROCESS_NAME,
  PURCHASE_PROCESS_NAME,
} from '../../transactions/transaction';

// Import shared components
import { H3, H4, NamedLink, OrderBreakdown, Page, TopbarSimplified } from '../../components';

import {
  bookingDatesMaybe,
  getFormattedTotalPrice,
  getShippingDetailsMaybe,
  getTransactionTypeData,
  hasPaymentExpired,
  hasTransactionPassedPendingPayment,
  hasTransactionPassedPurchased,
  persistTransaction,
  processCheckoutWithFlutterwave,
} from './CheckoutPageTransactionHelpers.js';
import { storeData } from './CheckoutPageSessionHelpers';
import { getErrorMessages } from './ErrorMessages';

import DetailsSideCard from './DetailsSideCard';
import MobileListingImage from './MobileListingImage';
import MobileOrderBreakdown from './MobileOrderBreakdown';

import css from './CheckoutPage.module.css';
import PaymentForm from './PaymentForm/PaymentForm.js';
import { useMemo } from 'react';
import { createResourceLocatorString } from '../../util/routes.js';

const capitalizeString = s => `${s.charAt(0).toUpperCase()}${s.substr(1)}`;

/**
 * Prefix the properties of the chosen price variant as first level properties for the protected data of the transaction
 *
 * @example
 * const priceVariant = {
 *   name: 'something',
 * }
 *
 * will be returned as:
 * const priceVariant = {
 *   priceVariantName: 'something',
 * }
 *
 * @param {Object} priceVariant - The price variant object
 * @returns {Object} The price variant object with the properties prefixed with priceVariant*
 */
const prefixPriceVariantProperties = priceVariant => {
  if (!priceVariant) {
    return {};
  }

  const entries = Object.entries(priceVariant).map(([key, value]) => {
    return [`priceVariant${capitalizeString(key)}`, value];
  });
  return Object.fromEntries(entries);
};

/**
 * Construct orderParams object using pageData from session storage, shipping details, and optional payment params.
 * Note: This is used for both speculate transition and real transition
 *       - Speculate transition is called, when the the component is mounted. It's used to test if the data can go through the API validation
 *       - Real transition is made, when the user submits the StripePaymentForm.
 *
 * @param {Object} pageData data that's saved to session storage.
 * @param {Object} shippingDetails shipping address if applicable.
 * @param {Object} optionalPaymentParams (E.g. paymentMethod or setupPaymentMethodForSaving)
 * @param {Object} config app-wide configs. This contains hosted configs too.
 * @returns orderParams.
 */
const getOrderParams = (pageData, shippingDetails, optionalPaymentParams, config) => {
  const quantity = pageData.orderData?.quantity;
  const quantityMaybe = quantity ? { quantity } : {};
  const seats = pageData.orderData?.seats;
  const seatsMaybe = seats ? { seats } : {};
  const deliveryMethod = pageData.orderData?.deliveryMethod;
  const initialMessage = pageData.orderData?.message;
  const initialMessageMaybe = initialMessage ? { initialMessage } : {};
  const deliveryMethodMaybe = deliveryMethod ? { deliveryMethod } : {};
  const { listingType, unitType, priceVariants } = pageData?.listing?.attributes?.publicData || {};

  // price variant data for fixed duration bookings
  const priceVariantName = pageData.orderData?.priceVariantName;
  const priceVariantNameMaybe = priceVariantName ? { priceVariantName } : {};
  const priceVariant = priceVariants?.find(pv => pv.name === priceVariantName);
  const priceVariantMaybe = priceVariant ? prefixPriceVariantProperties(priceVariant) : {};

  const protectedDataMaybe = {
    protectedData: {
      ...getTransactionTypeData(listingType, unitType, config),
      ...deliveryMethodMaybe,
      ...shippingDetails,
      ...priceVariantMaybe,
      ...initialMessageMaybe,
    },
  };

  // Note: Avoid misinterpreting the following logic as allowing arbitrary mixing of `quantity` and `seats`.
  // You can only pass either quantity OR seats and units to the orderParams object
  // Quantity represents the total booked units for the line item (e.g. days, hours).
  // When quantity is not passed, we pass seats and units.
  // If `bookingDatesMaybe` is provided, it determines `units`, and `seats` defaults to 1
  // (implying quantity = units)

  // These are the order parameters for the first payment-related transition
  // which is either initiate-transition or initiate-transition-after-enquiry
  const orderParams = {
    listingId: pageData?.listing?.id,
    ...deliveryMethodMaybe,
    ...quantityMaybe,
    ...seatsMaybe,
    ...bookingDatesMaybe(pageData.orderData?.bookingDates),
    ...priceVariantNameMaybe,
    ...protectedDataMaybe,
    ...optionalPaymentParams,
  };
  return orderParams;
};

const fetchSpeculatedTransactionIfNeeded = (orderParams, pageData, fetchSpeculatedTransaction) => {
  const tx = pageData ? pageData.transaction : null;
  const pageDataListing = pageData.listing;
  const processName =
    tx?.attributes?.processName ||
    pageDataListing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0];
  const process = processName ? getProcess(processName) : null;

  // If transaction has passed payment-pending state, speculated tx is not needed.
  const shouldFetchSpeculatedTransaction =
    !!pageData?.listing?.id &&
    !!pageData.orderData &&
    !!process &&
    !hasTransactionPassedPendingPayment(tx, process);

  if (shouldFetchSpeculatedTransaction) {
    const processAlias = pageData.listing.attributes.publicData?.transactionProcessAlias;
    const transactionId = tx ? tx.id : null;
    const isInquiryInPaymentProcess =
      tx?.attributes?.lastTransition === process.transitions.INQUIRE;
    const resolvedProcessName = resolveLatestProcessName(processName);
    const isOfferPendingInNegotiationProcess =
      resolvedProcessName === NEGOTIATION_PROCESS_NAME &&
      tx.attributes.state === `state/${process.states.OFFER_PENDING}`;

    const requestTransition = isInquiryInPaymentProcess
      ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
      : isOfferPendingInNegotiationProcess
      ? process.transitions.REQUEST_PAYMENT_TO_ACCEPT_OFFER
      : process.transitions.REQUEST_PAYMENT;
    const isPrivileged = process.isPrivileged(requestTransition);

    fetchSpeculatedTransaction(
      orderParams,
      processAlias,
      transactionId,
      requestTransition,
      isPrivileged
    );
  }
};

/**
 * Load initial data for the page
 *
 * Since the data for the checkout is not passed in the URL (there
 * might be lots of options in the future), we must pass in the data
 * some other way. Currently the ListingPage sets the initial data
 * for the CheckoutPage's Redux store.
 *
 * For some cases (e.g. a refresh in the CheckoutPage), the Redux
 * store is empty. To handle that case, we store the received data
 * to window.sessionStorage and read it from there if no props from
 * the store exist.
 *
 * This function also sets of fetching the speculative transaction
 * based on this initial data.
 */
export const loadInitialDataForPayments = ({ pageData, fetchSpeculatedTransaction, config }) => {
  // Fetch speculated transaction for showing price in order breakdown
  // NOTE: if unit type is line-item/item, quantity needs to be added.
  // The way to pass it to checkout page is through pageData.orderData
  const shippingDetails = {};
  const optionalPaymentParams = {};
  const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config);

  fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction);
};

const handleSubmit = (
  values,
  process,
  props,
  submitting,
  setSubmitting,
  setConfirmationProcessed
) => {
  if (submitting) {
    return;
  }
  setSubmitting(true);
  setConfirmationProcessed(false);

  const {
    config,
    speculatedTransaction,
    onInitiateOrder,
    onSendMessage,
    onCreateFlutterwaveCheckout,
    pageData,
    setPageData,
    sessionStorageKey,
  } = props;
  const { message, formValues } = values;

  // Save message to session storage so it can be sent after redirect if needed
  const { orderData, listing, transaction } = pageData;
  const updatedOrderData = { ...orderData, message };
  storeData(updatedOrderData, listing, transaction, sessionStorageKey);
  setPageData({ ...pageData, orderData: updatedOrderData });

  const requestPaymentParams = {
    pageData: { ...pageData, orderData: updatedOrderData },
    speculatedTransaction,
    process,
    onInitiateOrder,
    onSendMessage,
    onCreateFlutterwaveCheckout,
    sessionStorageKey,
    setPageData,
  };

  const shippingDetails = getShippingDetailsMaybe(formValues);
  const optionalPaymentParams = {};

  // These are the order parameters for the first payment-related transition
  // which is either initiate-transition or initiate-transition-after-enquiry
  const orderParams = getOrderParams(
    { ...pageData, orderData: updatedOrderData },
    shippingDetails,
    optionalPaymentParams,
    config
  );

  // Use processCheckoutWithFlutterwave instead of processCheckoutWithPayment
  processCheckoutWithFlutterwave(orderParams, requestPaymentParams).catch(err => {
    console.error(err);
    setSubmitting(false);
  });
};

/**
 * A component that renders the checkout page with payment.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled - Whether the page should scroll
 * @param {string} props.speculateTransactionError - The error message for the speculate transaction
 * @param {propTypes.transaction} props.speculatedTransaction - The speculated transaction
 * @param {boolean} props.isClockInSync - Whether the clock is in sync
 * @param {string} props.initiateOrderError - The error message for the initiate order
 * @param {string} props.confirmPaymentError - The error message for the confirm payment
 * @param {intlShape} props.intl - The intl object
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {Object} props.pageData - The page data
 * @param {propTypes.listing} props.pageData.listing - The listing entity
 * @param {boolean} props.showListingImage - A boolean indicating whether images are enabled with this listing type
 * @param {propTypes.transaction} props.pageData.transaction - The transaction entity
 * @param {Object} props.pageData.orderData - The order data
 * @param {string} props.processName - The process name
 * @param {string} props.listingTitle - The listing title
 * @param {string} props.title - The title
 * @param {Function} props.onInitiateOrder - The function to initiate the order
 * @param {Function} props.onConfirmPayment - The function to confirm the payment
 * @param {Function} props.onSendMessage - The function to send a message
 * @param {Function} props.onSubmitCallback - The function to submit the callback
 * @param {propTypes.error} props.initiateOrderError - The error message for the initiate order
 * @param {propTypes.error} props.confirmPaymentError - The error message for the confirm payment
 * @param {Object} props.config - The config
 * @param {Object} props.routeConfiguration - The route configuration
 * @param {Object} props.history - The history object
 * @param {Object} props.history.push - The push state function of the history object
 * @returns {JSX.Element}
 */
export const CheckoutPageWithPayment = props => {
  const [submitting, setSubmitting] = useState(false);
  const [confirmationProcessed, setConfirmationProcessed] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);

  const {
    scrollingDisabled,
    speculateTransactionError,
    speculatedTransaction: speculatedTransactionMaybe,
    isClockInSync,
    initiateOrderError,
    intl,
    currentUser,
    showListingImage,
    pageData,
    processName,
    listingTitle,
    title,
    config,
    onSubmitCallback,
    history,
    onConfirmPayment,
    onSendMessage,
    routeConfiguration,
    onVerifyPayment,
    setPageData,
    sessionStorageKey,
  } = props;

  // Since the listing data is already given from the ListingPage
  // and stored to handle refreshes, it might not have the possible
  // deleted or closed information in it. If the transaction
  // initiate or the speculative initiate fail due to the listing
  // being deleted or closed, we should dig the information from the
  // errors and not the listing data.
  const listingNotFound =
    isTransactionInitiateListingNotFoundError(speculateTransactionError) ||
    isTransactionInitiateListingNotFoundError(initiateOrderError);

  const { listing, transaction, orderData } = pageData;
  const existingTransaction = ensureTransaction(transaction);
  const speculatedTransaction = ensureTransaction(speculatedTransactionMaybe, {}, null);

  // If existing transaction has line-items, it has gone through one of the request-payment transitions.
  // Otherwise, we try to rely on speculatedTransaction for order breakdown data.
  const tx =
    existingTransaction?.attributes?.lineItems?.length > 0
      ? existingTransaction
      : speculatedTransaction;

  const process = processName ? getProcess(processName) : null;

  useEffect(() => {
    const params = new URLSearchParams(history.location.search);
    const status = params.get('status');
    const txRef = params.get('tx_ref');
    const flutterwaveTransactionId = params.get('transaction_id');

    if (
      status === 'successful' &&
      txRef &&
      flutterwaveTransactionId &&
      !submitting &&
      !confirmationProcessed &&
      tx.id
    ) {
      setSubmitting(true);
      setConfirmationProcessed(true);
      onVerifyPayment(flutterwaveTransactionId)
        .then(response => {
          const flutterwaveStatus = response.status;
          const lastestTransaction = response.sharetribeTransaction;
          persistTransaction(
            lastestTransaction,
            pageData,
            storeData,
            setPageData,
            sessionStorageKey
          );

          if (flutterwaveStatus === 'pending') {
            setSubmitting(false);
            setPaymentPending(true);
            // We don't want to proceed with confirmation if it's pending
            return Promise.reject({ name: 'PaymentPending' });
          }

          const transactionId = lastestTransaction.id;
          const transitionName = process.transitions.CONFIRM_PAYMENT;
          const alreadyConfirmed = hasTransactionPassedPurchased(lastestTransaction, process);
          const confirmPaymentFn = alreadyConfirmed
            ? Promise.resolve(lastestTransaction)
            : onConfirmPayment(transactionId, transitionName);

          return confirmPaymentFn;
        })
        .then(order => {
          //ensure persisted transaction is updated with the latest data
          persistTransaction(order, pageData, storeData, setPageData, sessionStorageKey);
          const message = pageData?.orderData?.message;
          if (message) {
            return onSendMessage({ id: tx.id, message });
          }
        })
        .then(() => {
          history.push(
            createResourceLocatorString('OrderDetailsPage', routeConfiguration, {
              id: tx.id.uuid,
            })
          );
          onSubmitCallback();
        })
        .catch(e => {
          if (e.name === 'PaymentPending') {
            return;
          }
          console.error('Payment confirmation failed', e);
          setSubmitting(false);
          setPaymentPending(false);
        });
    }
  }, [history.location.search, submitting, confirmationProcessed, pageData, props, tx.id, process]);

  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const priceVariantName = tx.attributes.protectedData?.priceVariantName;

  const txBookingMaybe = tx?.booking?.id ? { booking: tx.booking, timeZone } : {};

  // Show breakdown only when (speculated?) transaction is loaded
  // (i.e. it has an id and lineItems)
  const breakdown =
    tx.id && tx.attributes.lineItems?.length > 0 ? (
      <OrderBreakdown
        className={css.orderBreakdown}
        userRole="customer"
        transaction={tx}
        {...txBookingMaybe}
        currency={config.currency}
        marketplaceName={config.marketplaceName}
      />
    ) : null;

  const totalPrice =
    tx?.attributes?.lineItems?.length > 0 ? getFormattedTotalPrice(tx, intl) : null;

  const transitions = process.transitions;
  const isPaymentExpired = hasPaymentExpired(existingTransaction, process, isClockInSync);

  // Allow showing page when currentUser is still being downloaded,
  // but show payment form only when user info is loaded.
  const showPaymentForm = !!(
    currentUser &&
    !listingNotFound &&
    !initiateOrderError &&
    !speculateTransactionError &&
    !isPaymentExpired
  );

  const firstImage = listing?.images?.length > 0 ? listing.images[0] : null;

  const listingLink = (
    <NamedLink
      name="ListingPage"
      params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
    >
      <FormattedMessage id="CheckoutPage.errorlistingLinkText" />
    </NamedLink>
  );

  const errorMessages = getErrorMessages(
    listingNotFound,
    initiateOrderError,
    isPaymentExpired,
    speculateTransactionError,
    listingLink
  );

  const paymentPendingMessage = paymentPending ? (
    <p className={css.orderError}>
      <FormattedMessage id="CheckoutPage.paymentPendingMessage" />
    </p>
  ) : null;

  const isBooking = processName === BOOKING_PROCESS_NAME;
  const isPurchase = processName === PURCHASE_PROCESS_NAME;
  const isNegotiation = processName === NEGOTIATION_PROCESS_NAME;

  const txTransitions = existingTransaction?.attributes?.transitions || [];
  const hasInquireTransition = txTransitions.find(tr => tr.transition === transitions.INQUIRE);
  const showInitialMessageInput = !hasInquireTransition && !isNegotiation;

  const askShippingDetails =
    orderData?.deliveryMethod === 'shipping' &&
    !hasTransactionPassedPendingPayment(existingTransaction, process);

  const listingLocation = listing?.attributes?.publicData?.location;
  const showPickUpLocation = isPurchase && orderData?.deliveryMethod === 'pickup';
  const showLocation = (isBooking || isNegotiation) && listingLocation?.address;

  const providerDisplayName = isNegotiation
    ? existingTransaction?.provider?.attributes?.profile?.displayName
    : listing?.author?.attributes?.profile?.displayName;

  const initialMessage = orderData?.message || tx.attributes.protectedData?.initialMessage;
  const initialValues = useMemo(() => {
    return {
      message: initialMessage,
    };
  }, [initialMessage]);
  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <TopbarSimplified />
      <div className={css.contentContainer}>
        <MobileListingImage
          listingTitle={listingTitle}
          author={listing?.author}
          firstImage={firstImage}
          layoutListingImageConfig={config.layout.listingImage}
          showListingImage={showListingImage}
        />
        <main className={css.orderFormContainer}>
          <div className={css.headingContainer}>
            <H3 as="h1" className={css.heading}>
              {title}
            </H3>
            <H4 as="h2" className={css.detailsHeadingMobile}>
              <FormattedMessage id="CheckoutPage.listingTitle" values={{ listingTitle }} />
            </H4>
          </div>
          <MobileOrderBreakdown
            speculateTransactionErrorMessage={errorMessages.speculateTransactionErrorMessage}
            breakdown={breakdown}
            priceVariantName={priceVariantName}
          />
          <section className={css.paymentContainer}>
            {errorMessages.initiateOrderErrorMessage}
            {errorMessages.listingNotFoundErrorMessage}
            {errorMessages.speculateErrorMessage}
            {errorMessages.paymentExpiredMessage}
            {paymentPendingMessage}

            {showPaymentForm ? (
              <PaymentForm
                initialValues={initialValues}
                keepDirtyOnReinitialize={true}
                className={css.paymentForm}
                formId="CheckoutPagePaymentForm"
                onSubmit={values =>
                  handleSubmit(
                    values,
                    process,
                    props,
                    submitting,
                    setSubmitting,
                    setConfirmationProcessed
                  )
                }
                inProgress={submitting || paymentPending}
                initiateOrderError={initiateOrderError}
                askShippingDetails={askShippingDetails}
                listingLocation={listingLocation}
                showPickUpLocation={showPickUpLocation}
                showLocation={showLocation}
                totalPrice={totalPrice}
                locale={intl.locale}
                providerDisplayName={providerDisplayName}
                showInitialMessageInput={showInitialMessageInput}
                isBooking={isBooking}
                isFuzzyLocation={config.maps.fuzzy.enabled}
              />
            ) : null}
          </section>
        </main>

        <DetailsSideCard
          listing={listing}
          listingTitle={listingTitle}
          priceVariantName={priceVariantName}
          author={listing?.author}
          firstImage={firstImage}
          layoutListingImageConfig={config.layout.listingImage}
          speculateTransactionErrorMessage={errorMessages.speculateTransactionErrorMessage}
          isInquiryProcess={false}
          processName={processName}
          breakdown={breakdown}
          showListingImage={showListingImage}
          intl={intl}
        />
      </div>
    </Page>
  );
};

export default CheckoutPageWithPayment;
