import React, { Component } from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, injectIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';

import { Heading, Form, PrimaryButton, FieldTextInput } from '../../../components';

import ShippingDetails from '../ShippingDetails/ShippingDetails';
import css from './PaymentForm.module.css';

const LocationOrShippingDetails = props => {
  const {
    askShippingDetails,
    showPickUpLocation,
    showLocation,
    listingLocation,
    formApi,
    locale,
    isFuzzyLocation,
    intl,
  } = props;

  const locationDetails = listingLocation?.building
    ? `${listingLocation.building}, ${listingLocation.address}`
    : listingLocation?.address
    ? listingLocation.address
    : intl.formatMessage({ id: 'StripePaymentForm.locationUnknown' });

  return askShippingDetails ? (
    <ShippingDetails intl={intl} formApi={formApi} locale={locale} />
  ) : showPickUpLocation ? (
    <div className={css.locationWrapper}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="StripePaymentForm.pickupDetailsTitle" />
      </Heading>
      <p className={css.locationDetails}>{locationDetails}</p>
    </div>
  ) : showLocation && !isFuzzyLocation ? (
    <div className={css.locationWrapper}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="StripePaymentForm.locationDetailsTitle" />
      </Heading>
      <p className={css.locationDetails}>{locationDetails}</p>
    </div>
  ) : null;
};

class PaymentFormComponent extends Component {
  constructor(props) {
    super(props);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.paymentForm = this.paymentForm.bind(this);
  }

  handleSubmit(values) {
    const { onSubmit, inProgress, formId } = this.props;
    const { initialMessage } = values;

    if (inProgress) {
      return;
    }

    const params = {
      message: initialMessage ? initialMessage.trim() : null,
      formId,
      formValues: values,
    };
    onSubmit(params);
  }

  paymentForm(formRenderProps) {
    const {
      className,
      rootClassName,
      inProgress: submitInProgress,
      formId,
      providerDisplayName,
      showInitialMessageInput,
      intl,
      initiateOrderError,
      handleSubmit,
      form: formApi,
      listingLocation,
      askShippingDetails,
      showLocation,
      showPickUpLocation,
      totalPrice,
      locale,
      isBooking,
      isFuzzyLocation,
      errors,
    } = formRenderProps;

    const submitDisabled = submitInProgress;
    const classes = classNames(rootClassName || css.root, className);

    const totalPriceMaybe = totalPrice || '';

    const messagePlaceholder = intl.formatMessage(
      { id: 'StripePaymentForm.messagePlaceholder' },
      { name: providerDisplayName }
    );

    const messageOptionalText = intl.formatMessage({
      id: 'StripePaymentForm.messageOptionalText',
    });

    const initialMessageLabel = intl.formatMessage(
      { id: 'StripePaymentForm.messageLabel' },
      { messageOptionalText: messageOptionalText }
    );

    const isBookingYesNo = isBooking ? 'yes' : 'no';

    return (
      <Form className={classes} onSubmit={handleSubmit} enforcePagePreloadFor="OrderDetailsPage">
        <LocationOrShippingDetails
          askShippingDetails={askShippingDetails}
          showPickUpLocation={showPickUpLocation}
          showLocation={showLocation}
          listingLocation={listingLocation}
          isFuzzyLocation={isFuzzyLocation}
          formApi={formApi}
          locale={locale}
          intl={intl}
        />

        {initiateOrderError ? (
          <span className={css.errorMessage}>{initiateOrderError.message}</span>
        ) : null}

        {showInitialMessageInput ? (
          <div>
            <Heading as="h3" rootClassName={css.heading}>
              <FormattedMessage id="StripePaymentForm.messageHeading" />
            </Heading>

            <FieldTextInput
              type="textarea"
              id={`${formId}-message`}
              name="initialMessage"
              label={initialMessageLabel}
              placeholder={messagePlaceholder}
              className={css.message}
            />
          </div>
        ) : null}

        <div className={css.submitContainer}>
          <PrimaryButton
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
          >
            <FormattedMessage
              id="StripePaymentForm.submitPaymentInfo"
              values={{ totalPrice: totalPriceMaybe, isBooking: isBookingYesNo }}
            />
          </PrimaryButton>
        </div>
      </Form>
    );
  }

  render() {
    const { onSubmit, ...rest } = this.props;
    return <FinalForm onSubmit={this.handleSubmit} {...rest} render={this.paymentForm} />;
  }
}

const PaymentForm = injectIntl(PaymentFormComponent);

export default PaymentForm;
