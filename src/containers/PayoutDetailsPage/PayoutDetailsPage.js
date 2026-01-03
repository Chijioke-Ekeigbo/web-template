import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { ensureCurrentUser } from '../../util/data';
import { propTypes } from '../../util/types';
import { showCreateListingLinkForUser, showPaymentDetailsForUser } from '../../util/userHelpers';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { flutterwaveSubaccountClearError } from '../../ducks/flutterwaveSubaccount.duck';

import {
  H3,
  Page,
  FlutterwaveSubaccountForm,
  UserNav,
  LayoutSideNavigation,
} from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { savePayoutDetails } from './PayoutDetailsPage.duck';

import css from './PayoutDetailsPage.module.css';

// Get Flutterwave subaccount data
// The subaccountId is stored in privateData.flutterwaveSubaccountId
// The full subaccount data comes from the Redux state (fetched from API)
const getFlutterwaveSubaccount = currentUser => {
  if (!currentUser || !currentUser.attributes || !currentUser.attributes.profile) {
    return null;
  }
  const privateData = currentUser.attributes.profile.privateData || {};
  return privateData.flutterwaveSubaccount?.subaccountId || null;
};

/**
 * PayoutDetailsPage component
 *
 * @component
 * @param {Object} props
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {boolean} props.scrollingDisabled - Whether scrolling is disabled
 * @param {boolean} props.payoutDetailsSaveInProgress - Whether the payout details are in progress
 * @param {propTypes.error} props.createSubaccountError - The create subaccount error
 * @param {propTypes.error} props.updateSubaccountError - The update subaccount error
 * @param {propTypes.error} props.fetchSubaccountError - The fetch subaccount error
 * @param {Object} props.subaccount - The flutterwave subaccount
 * @param {boolean} props.subaccountFetched - Whether the subaccount is fetched
 * @param {boolean} props.payoutDetailsSaved - Whether the payout details are saved
 * @param {Function} props.onPayoutDetailsChange - The function to handle the payout details change
 * @param {Function} props.onPayoutDetailsSubmit - The function to handle the payout details submit
 * @returns {JSX.Element}
 */
export const PayoutDetailsPageComponent = props => {
  const config = useConfiguration();
  const routes = useRouteConfiguration();
  const intl = useIntl();
  const {
    currentUser,
    scrollingDisabled,
    createSubaccountError,
    updateSubaccountError,
    fetchSubaccountError,
    subaccountFetched,
    subaccount,
    onPayoutDetailsChange,
    onPayoutDetailsSubmit,
    payoutDetailsSaveInProgress,
    payoutDetailsSaved,
    authScopes,
  } = props;
  const ensuredCurrentUser = ensureCurrentUser(currentUser);
  const currentUserLoaded = !!ensuredCurrentUser.id;
  const flutterwaveConnected = currentUserLoaded && !!subaccount;

  const title = intl.formatMessage({ id: 'PayoutDetailsPage.title' });

  // Extract saved data from fetched subaccount
  const savedCountry = subaccount ? subaccount.country : '';
  const savedAccountBank = subaccount ? subaccount.accountBank : '';
  const savedAccountNumber = subaccount ? subaccount.accountNumber : '';
  const savedBusinessName = subaccount
    ? subaccount.businessName
    : currentUser?.attributes?.profile?.displayName || '';

  const savedBusinessNumber = subaccount ? subaccount.businessNumber : '';

  // Check if user has limited rights and set button titles accordingly
  const limitedRights = authScopes?.indexOf('user:limited') >= 0;

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { showPayoutDetails, showPaymentMethods } = showPaymentDetailsForUser(config, currentUser);
  const accountSettingsNavProps = {
    currentPage: 'PayoutDetailsPage',
    showPaymentMethods,
    showPayoutDetails,
  };

  const initialValues = {
    country: savedCountry,
    accountBank: savedAccountBank,
    accountNumber: savedAccountNumber,
    businessName: savedBusinessName,
    businessNumber: savedBusinessNumber,
  };
  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            <UserNav
              currentPage="PayoutDetailsPage"
              showManageListingsLink={showManageListingsLink}
            />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        accountSettingsNavProps={accountSettingsNavProps}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="PayoutDetailsPage.heading" />
          </H3>
          {!currentUserLoaded ? (
            <FormattedMessage id="PayoutDetailsPage.loadingData" />
          ) : (
            <FlutterwaveSubaccountForm
              initialValues={initialValues}
              rootClassName={css.flutterwaveSubaccountForm}
              disabled={false}
              inProgress={payoutDetailsSaveInProgress}
              ready={payoutDetailsSaved}
              currentUser={ensuredCurrentUser}
              savedCountry={savedCountry}
              savedAccountBank={savedAccountBank}
              savedAccountNumber={savedAccountNumber}
              savedBusinessName={savedBusinessName}
              savedBusinessNumber={savedBusinessNumber}
              submitButtonText={intl.formatMessage({
                id: 'PayoutDetailsPage.submitButtonText',
              })}
              flutterwaveSubaccountError={
                createSubaccountError || updateSubaccountError || fetchSubaccountError
              }
              subaccountFetched={subaccountFetched}
              onChange={onPayoutDetailsChange}
              onSubmit={onPayoutDetailsSubmit}
              flutterwaveConnected={flutterwaveConnected}
              authScopes={authScopes}
            />
          )}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const {
    createSubaccountError,
    updateSubaccountError,
    subaccount,
    subaccountFetched,
  } = state.flutterwaveSubaccount;
  const { currentUser } = state.user;
  const { payoutDetailsSaveInProgress, payoutDetailsSaved } = state.PayoutDetailsPage;
  const { authScopes } = state.auth;
  return {
    currentUser,
    createSubaccountError,
    updateSubaccountError,
    subaccount,
    subaccountFetched,
    payoutDetailsSaveInProgress,
    payoutDetailsSaved,
    scrollingDisabled: isScrollingDisabled(state),
    authScopes,
  };
};

const mapDispatchToProps = dispatch => ({
  onPayoutDetailsChange: () => dispatch(flutterwaveSubaccountClearError()),
  onPayoutDetailsSubmit: (values, isUpdateCall) =>
    dispatch(savePayoutDetails(values, isUpdateCall)),
});

const PayoutDetailsPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(PayoutDetailsPageComponent);

export default PayoutDetailsPage;
