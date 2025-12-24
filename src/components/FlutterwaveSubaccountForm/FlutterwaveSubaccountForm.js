import React, { useEffect, useCallback } from 'react';
import { Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import * as validators from '../../util/validators';
import { propTypes } from '../../util/types';
import {
  getBanksByCountry,
  clearBanks,
  flutterwaveSubaccountClearError,
} from '../../ducks/flutterwaveSubaccount.duck';

import { H4, Button, FieldSelect, FieldTextInput, Form, BankSearchInput } from '../../components';

import css from './FlutterwaveSubaccountForm.module.css';

// Flutterwave supported countries (common ones)
// You can expand this list based on Flutterwave's actual supported countries
const FLUTTERWAVE_SUPPORTED_COUNTRIES = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'SN', name: 'Senegal' },
  { code: 'CI', name: "Côte d'Ivoire" },
  { code: 'CM', name: 'Cameroon' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'ML', name: 'Mali' },
  { code: 'BJ', name: 'Benin' },
  { code: 'TG', name: 'Togo' },
  { code: 'NE', name: 'Niger' },
  { code: 'GA', name: 'Gabon' },
  { code: 'CD', name: 'DRC' },
  { code: 'AO', name: 'Angola' },
  { code: 'ET', name: 'Ethiopia' },
];

const CreateFlutterwaveSubaccountFields = props => {
  const {
    disabled,
    countryLabel,
    showAsRequired,
    formApi,
    values,
    intl,
    banks,
    getBanksInProgress,
    onCountryChange,
  } = props;

  const selectedCountry = values?.country;

  // Fetch banks when country changes
  useEffect(() => {
    if (selectedCountry) {
      onCountryChange(selectedCountry);
    }
  }, [selectedCountry, onCountryChange]);

  return (
    <div className={css.sectionContainer}>
      <FieldSelect
        id="country"
        name="country"
        disabled={disabled}
        className={css.field}
        autoComplete="country"
        label={countryLabel}
        validate={validators.required(
          intl.formatMessage({
            id: 'FlutterwaveSubaccountForm.countryRequired',
          })
        )}
      >
        <option disabled value="">
          {intl.formatMessage({ id: 'FlutterwaveSubaccountForm.countryPlaceholder' })}
        </option>
        {FLUTTERWAVE_SUPPORTED_COUNTRIES.map(c => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </FieldSelect>

      {selectedCountry && (
        <BankSearchInput
          id="accountBank"
          name="accountBank"
          className={css.field}
          label={intl.formatMessage({ id: 'FlutterwaveSubaccountForm.accountBankLabel' })}
          banks={banks}
          disabled={disabled || getBanksInProgress}
          placeholder={intl.formatMessage({
            id: 'FlutterwaveSubaccountForm.accountBankPlaceholder',
          })}
          validate={validators.required(
            intl.formatMessage({
              id: 'FlutterwaveSubaccountForm.accountBankRequired',
            })
          )}
        />
      )}

      <FieldTextInput
        id="accountNumber"
        name="accountNumber"
        type="text"
        className={css.field}
        label={intl.formatMessage({ id: 'FlutterwaveSubaccountForm.accountNumberLabel' })}
        disabled={disabled}
        validate={validators.required(
          intl.formatMessage({
            id: 'FlutterwaveSubaccountForm.accountNumberRequired',
          })
        )}
      />

      <FieldTextInput
        id="businessName"
        name="businessName"
        type="text"
        className={css.field}
        label={intl.formatMessage({ id: 'FlutterwaveSubaccountForm.businessNameLabel' })}
        disabled={disabled}
        validate={validators.required(
          intl.formatMessage({
            id: 'FlutterwaveSubaccountForm.businessNameRequired',
          })
        )}
      />

      <FieldTextInput
        id="businessNumber"
        name="businessNumber"
        type="text"
        className={css.field}
        label={intl.formatMessage({ id: 'FlutterwaveSubaccountForm.businessNumberLabel' })}
        disabled={disabled}
      />
    </div>
  );
};

const UpdateFlutterwaveSubaccountFields = props => {
  const {
    countryLabel,
    savedCountry,
    savedAccountBank,
    savedAccountNumber,
    savedBusinessName,
    savedBusinessNumber,
    formApi,
    values,
    intl,
    banks,
    getBanksInProgress,
    onCountryChange,
  } = props;

  const selectedCountry = values?.country || savedCountry;

  // Fetch banks when country changes
  useEffect(() => {
    if (selectedCountry) {
      onCountryChange(selectedCountry);
    }
  }, [selectedCountry, onCountryChange]);

  const selectedBank = banks.find(bank => bank.code === savedAccountBank);

  return (
    <div className={css.sectionContainer}>
      <div className={css.savedInformation}>
        <label className={css.accountInformationTitle}>{countryLabel}</label>
        <div className={css.savedCountry}>
          {FLUTTERWAVE_SUPPORTED_COUNTRIES.find(c => c.code === savedCountry)?.name || savedCountry}
        </div>
      </div>

      {selectedCountry && (
        <div className={css.savedInformation}>
          <label className={css.accountInformationTitle}>
            {intl.formatMessage({ id: 'FlutterwaveSubaccountForm.accountBankLabel' })}
          </label>
          <div className={css.savedCountry}>{selectedBank?.name || savedAccountBank}</div>
        </div>
      )}

      <FieldTextInput
        className={css.field}
        id="accountNumber"
        name="accountNumber"
        type="text"
        label={intl.formatMessage({ id: 'FlutterwaveSubaccountForm.accountNumberLabel' })}
      />

      <FieldTextInput
        className={css.field}
        id="businessName"
        name="businessName"
        type="text"
        label={intl.formatMessage({ id: 'FlutterwaveSubaccountForm.businessNameLabel' })}
      />
    </div>
  );
};

const ErrorsMaybe = props => {
  const { flutterwaveSubaccountError } = props;

  const errorMessage = flutterwaveSubaccountError ? (
    <FormattedMessage id="FlutterwaveSubaccountForm.createSubaccountFailed" />
  ) : null;

  return errorMessage ? <div className={css.error}>{errorMessage}</div> : null;
};

/**
 * A component that renders a Flutterwave subaccount form.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {function} props.onSubmit - The function to call when the form is submitted
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {Object} props.flutterwaveSubaccountError - The Flutterwave subaccount error
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.inProgress - Whether the form is in progress
 * @param {boolean} props.ready - Whether the form is ready
 * @param {string} props.savedCountry - The saved country
 * @param {string} props.savedAccountBank - The saved account bank
 * @param {boolean} props.flutterwaveSubaccountFetched - Whether the Flutterwave subaccount data is fetched
 * @param {string} props.submitButtonText - The text for the submit button
 * @returns {JSX.Element}
 */
const FlutterwaveSubaccountForm = props => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const { onSubmit, ...restOfProps } = props;
  const isUpdate = props.flutterwaveConnected;

  const { banks, getBanksInProgress } = useSelector(state => state.flutterwaveSubaccount);

  const handleCountryChange = useCallback(
    country => {
      if (country) {
        dispatch(getBanksByCountry(country));
      } else {
        dispatch(clearBanks());
      }
    },
    [dispatch]
  );

  return (
    <FinalForm
      {...restOfProps}
      onSubmit={values => onSubmit(values, isUpdate)}
      mutators={{
        ...arrayMutators,
      }}
      render={fieldRenderProps => {
        const {
          rootClassName,
          className,
          children,
          flutterwaveSubaccountError,
          disabled,
          handleSubmit,
          inProgress,
          invalid,
          pristine,
          ready,
          savedCountry,
          savedAccountBank,
          savedAccountNumber,
          savedBusinessName,
          savedBusinessNumber,
          flutterwaveSubaccountFetched,
          submitButtonText,
          form: formApi,
          values,
          flutterwaveConnected,
          currentUser,
          authScopes,
        } = fieldRenderProps;

        // Check if current user has limited rights in order to disable the submit button
        const limitedRights = authScopes?.indexOf('user:limited') >= 0;

        const accountDataLoaded =
          flutterwaveConnected && flutterwaveSubaccountFetched && savedCountry;
        const submitInProgress = inProgress;
        const submitDisabled =
          pristine ||
          invalid ||
          disabled ||
          submitInProgress ||
          limitedRights ||
          (!flutterwaveConnected && !values?.country);

        const countryLabel = intl.formatMessage({ id: 'FlutterwaveSubaccountForm.countryLabel' });
        const classes = classNames(rootClassName || css.root, className, {
          [css.disabled]: disabled,
        });

        const showAsRequired = pristine;

        // If the user doesn't have Flutterwave subaccount,
        // show fields for all details.
        // Otherwise, show only editable fields
        const flutterwaveSubaccountFields = !flutterwaveConnected ? (
          <CreateFlutterwaveSubaccountFields
            disabled={disabled}
            showAsRequired={showAsRequired}
            countryLabel={countryLabel}
            formApi={formApi}
            values={values}
            intl={intl}
            banks={banks}
            getBanksInProgress={getBanksInProgress}
            onCountryChange={handleCountryChange}
          />
        ) : (
          <UpdateFlutterwaveSubaccountFields
            countryLabel={countryLabel}
            savedCountry={savedCountry}
            savedAccountBank={savedAccountBank}
            savedAccountNumber={savedAccountNumber}
            savedBusinessName={savedBusinessName}
            savedBusinessNumber={savedBusinessNumber}
            formApi={formApi}
            values={values}
            intl={intl}
            banks={banks}
            getBanksInProgress={getBanksInProgress}
            onCountryChange={handleCountryChange}
          />
        );

        // Add button title for hovering to explain why the button is disabled when user has limited rights
        const submitButtonTitle = limitedRights
          ? intl.formatMessage({ id: 'FlutterwaveSubaccountForm.buttonTitleLimitedAccess' })
          : null;

        // Don't show the submit button while fetching the Flutterwave subaccount data
        const submitButtonMaybe =
          !flutterwaveConnected || accountDataLoaded ? (
            <Button
              type="submit"
              inProgress={submitInProgress}
              disabled={submitDisabled}
              ready={ready}
              title={submitButtonTitle}
            >
              {submitButtonText || (
                <FormattedMessage id="FlutterwaveSubaccountForm.submitButtonText" />
              )}
            </Button>
          ) : null;

        return (
          <Form className={classes} onSubmit={handleSubmit}>
            {!flutterwaveConnected || accountDataLoaded ? (
              flutterwaveSubaccountFields
            ) : (
              <div className={css.savedInformation}>
                <FormattedMessage id="FlutterwaveSubaccountForm.loadingSubaccountData" />
              </div>
            )}

            <ErrorsMaybe flutterwaveSubaccountError={flutterwaveSubaccountError} />

            {children}

            {submitButtonMaybe}
          </Form>
        );
      }}
    />
  );
};

export default FlutterwaveSubaccountForm;
