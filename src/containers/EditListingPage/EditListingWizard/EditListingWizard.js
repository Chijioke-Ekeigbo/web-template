import React, { Component, useEffect } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { useConfiguration } from '../../../context/configurationContext';
import { useRouteConfiguration } from '../../../context/routeConfigurationContext';
import { FormattedMessage, intlShape, useIntl } from '../../../util/reactIntl';
import {
  displayDeliveryPickup,
  displayDeliveryShipping,
  displayLocation,
  displayPrice,
  requirePayoutDetails,
  requireListingImage,
} from '../../../util/configHelpers';
import {
  LISTING_PAGE_PARAM_TYPE_DRAFT,
  LISTING_PAGE_PARAM_TYPE_NEW,
} from '../../../util/urlHelpers';
import { createResourceLocatorString } from '../../../util/routes';
import {
  SCHEMA_TYPE_ENUM,
  SCHEMA_TYPE_MULTI_ENUM,
  SCHEMA_TYPE_TEXT,
  SCHEMA_TYPE_LONG,
  SCHEMA_TYPE_BOOLEAN,
  SCHEMA_TYPE_YOUTUBE,
  propTypes,
} from '../../../util/types';
import {
  isFieldForCategory,
  isFieldForListingType,
  pickCategoryFields,
} from '../../../util/fieldHelpers';
import { ensureCurrentUser, ensureListing } from '../../../util/data';
import { INQUIRY_PROCESS_NAME, resolveLatestProcessName } from '../../../transactions/transaction';

// Import shared components
import {
  Heading,
  Modal,
  NamedRedirect,
  Tabs,
  FlutterwaveSubaccountForm,
} from '../../../components';

// Import modules from this directory
import EditListingWizardTab, {
  DETAILS,
  PRICING,
  PRICING_AND_STOCK,
  DELIVERY,
  LOCATION,
  AVAILABILITY,
  PHOTOS,
  STYLE,
} from './EditListingWizardTab';
import css from './EditListingWizard.module.css';

// This is the initial tab on editlisting wizard.
// When listing type is known, other tabs are checked from _tabsForListingType_ function.
const TABS_DETAILS_ONLY = [DETAILS];

// Tabs are horizontal in small screens
const MAX_HORIZONTAL_NAV_SCREEN_WIDTH = 1023;

/**
 * Pick only allowed tabs for the given process and listing type configuration.
 * - The location tab could be omitted for booking process
 * - The delivery tab could be omitted for purchase process
 * - The location and pricing tabs could be omitted for negotiation process
 * - The location and pricing tabs could be omitted for inquiry process
 *
 * @param {string} processName - The name of the process
 * @param {Object} listingTypeConfig - The listing type configuration
 * @returns {Array<string>} - The allowed tabs for the given process and listing type configuration
 */
const tabsForListingType = (processName, listingTypeConfig) => {
  const locationMaybe = displayLocation(listingTypeConfig) ? [LOCATION] : [];
  const pricingMaybe = displayPrice(listingTypeConfig) ? [PRICING] : [];
  const deliveryMaybe =
    displayDeliveryPickup(listingTypeConfig) || displayDeliveryShipping(listingTypeConfig)
      ? [DELIVERY]
      : [];
  const styleOrPhotosTab = requireListingImage(listingTypeConfig) ? [PHOTOS] : [STYLE];

  // You can reorder these panels.
  // Note 1: You need to change save button translations for new listing flow
  // Note 2: Ensure that draft listing is created after the first panel
  //         and listing publishing happens after last panel.
  // Note 3: The first tab creates a draft listing and title is mandatory attribute for it.
  //         Details tab asks for "title" and is therefore the first tab in the wizard flow.
  const tabs = {
    ['default-booking']: [DETAILS, ...locationMaybe, PRICING, AVAILABILITY, ...styleOrPhotosTab],
    ['default-purchase']: [DETAILS, PRICING_AND_STOCK, ...deliveryMaybe, ...styleOrPhotosTab],
    ['default-negotiation']: [DETAILS, ...locationMaybe, ...pricingMaybe, ...styleOrPhotosTab],
    ['default-inquiry']: [DETAILS, ...locationMaybe, ...pricingMaybe, ...styleOrPhotosTab],
  };

  return tabs[processName] || tabs['default-inquiry'];
};

/**
 * Return translations for wizard tab: label and submit button.
 *
 * @param {Object} intl
 * @param {string} tab name of the tab/panel in the wizard
 * @param {boolean} isNewListingFlow
 * @param {string} processName
 */
const tabLabelAndSubmit = (intl, tab, isNewListingFlow, isPriceDisabled, processName) => {
  const processNameString = isNewListingFlow ? `${processName}.` : '';
  const newOrEdit = isNewListingFlow ? 'new' : 'edit';

  let labelKey = null;
  let submitButtonKey = null;
  if (tab === DETAILS) {
    labelKey = 'EditListingWizard.tabLabelDetails';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.saveDetails`;
  } else if (tab === PRICING) {
    labelKey = 'EditListingWizard.tabLabelPricing';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.savePricing`;
  } else if (tab === PRICING_AND_STOCK) {
    labelKey = 'EditListingWizard.tabLabelPricingAndStock';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.savePricingAndStock`;
  } else if (tab === DELIVERY) {
    labelKey = 'EditListingWizard.tabLabelDelivery';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.saveDelivery`;
  } else if (tab === LOCATION) {
    labelKey = 'EditListingWizard.tabLabelLocation';
    submitButtonKey =
      isPriceDisabled && isNewListingFlow
        ? `EditListingWizard.${processNameString}${newOrEdit}.saveLocationNoPricingTab`
        : `EditListingWizard.${processNameString}${newOrEdit}.saveLocation`;
  } else if (tab === AVAILABILITY) {
    labelKey = 'EditListingWizard.tabLabelAvailability';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.saveAvailability`;
  } else if (tab === PHOTOS) {
    labelKey = 'EditListingWizard.tabLabelPhotos';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.savePhotos`;
  } else if (tab === STYLE) {
    labelKey = 'EditListingWizard.tabLabelStyle';
    submitButtonKey = `EditListingWizard.${processNameString}${newOrEdit}.saveStyle`;
  }

  return {
    label: intl.formatMessage({ id: labelKey }),
    submitButton: intl.formatMessage({ id: submitButtonKey }),
  };
};

/**
 * Validate listing fields (in extended data) that are included through configListing.js
 * This is used to check if listing creation flow can show the "next" tab as active.
 *
 * @param {Object} publicData
 * @param {Object} privateData
 */
const hasValidListingFieldsInExtendedData = (publicData, privateData, config) => {
  const isValidField = (fieldConfig, fieldData) => {
    const { key, schemaType, enumOptions = [], saveConfig = {} } = fieldConfig;

    const schemaOptionKeys = enumOptions.map(o => `${o.option}`);
    const hasValidEnumValue = optionData => {
      return schemaOptionKeys.includes(optionData);
    };
    const hasValidMultiEnumValues = savedOptions => {
      return savedOptions.every(optionData => schemaOptionKeys.includes(optionData));
    };

    const categoryKey = config.categoryConfiguration.key;
    const categoryOptions = config.categoryConfiguration.categories;
    const categoriesObj = pickCategoryFields(publicData, categoryKey, 1, categoryOptions);
    const currentCategories = Object.values(categoriesObj);

    const isTargetListingType = isFieldForListingType(publicData?.listingType, fieldConfig);
    const isTargetCategory = isFieldForCategory(currentCategories, fieldConfig);
    const isRequired = !!saveConfig.isRequired && isTargetListingType && isTargetCategory;

    if (isRequired) {
      const savedListingField = fieldData[key];
      return schemaType === SCHEMA_TYPE_ENUM
        ? typeof savedListingField === 'string' && hasValidEnumValue(savedListingField)
        : schemaType === SCHEMA_TYPE_MULTI_ENUM
        ? Array.isArray(savedListingField) && hasValidMultiEnumValues(savedListingField)
        : schemaType === SCHEMA_TYPE_TEXT
        ? typeof savedListingField === 'string'
        : schemaType === SCHEMA_TYPE_LONG
        ? typeof savedListingField === 'number' && Number.isInteger(savedListingField)
        : schemaType === SCHEMA_TYPE_BOOLEAN
        ? savedListingField === true || savedListingField === false
        : schemaType === SCHEMA_TYPE_YOUTUBE
        ? typeof savedListingField === 'string'
        : false;
    }
    return true;
  };
  return config.listing.listingFields.reduce((isValid, fieldConfig) => {
    const data = fieldConfig.scope === 'private' ? privateData : publicData;
    return isValid && isValidField(fieldConfig, data);
  }, true);
};

/**
 * Check if a wizard tab is completed.
 *
 * @param tab wizard's tab
 * @param listing is contains some specific data if tab is completed
 *
 * @return true if tab / step is completed.
 */
const tabCompleted = (tab, listing, config) => {
  const {
    availabilityPlan,
    description,
    geolocation,
    price,
    title,
    publicData,
    privateData,
  } = listing.attributes;
  const images = listing.images;
  const {
    listingType,
    transactionProcessAlias,
    unitType,
    shippingEnabled,
    pickupEnabled,
    cardStyle,
  } = publicData || {};
  const deliveryOptionPicked = publicData && (shippingEnabled || pickupEnabled);

  switch (tab) {
    case DETAILS:
      return !!(
        description &&
        title &&
        listingType &&
        transactionProcessAlias &&
        unitType &&
        hasValidListingFieldsInExtendedData(publicData, privateData, config)
      );
    case PRICING:
      return !!price;
    case PRICING_AND_STOCK:
      return !!price;
    case DELIVERY:
      return !!deliveryOptionPicked;
    case LOCATION:
      return !!(geolocation && publicData?.location?.address);
    case AVAILABILITY:
      return !!availabilityPlan;
    case PHOTOS:
      return images && images.length > 0;
    case STYLE:
      return !!cardStyle;
    default:
      return false;
  }
};

/**
 * Check which wizard tabs are active and which are not yet available. Tab is active if previous
 * tab is completed. In edit mode all tabs are active.
 *
 * @param isNew flag if a new listing is being created or an old one being edited
 * @param listing data to be checked
 * @param tabs array of tabs used for this listing. These depend on transaction process.
 *
 * @return object containing activity / editability of different tabs of this wizard
 */
const tabsActive = (isNew, listing, tabs, config) => {
  return tabs.reduce((acc, tab) => {
    const previousTabIndex = tabs.findIndex(t => t === tab) - 1;
    const validTab = previousTabIndex >= 0;
    const hasListingType = !!listing?.attributes?.publicData?.listingType;
    const prevTabComletedInNewFlow = tabCompleted(tabs[previousTabIndex], listing, config);
    const isActive =
      validTab && !isNew ? hasListingType : validTab && isNew ? prevTabComletedInNewFlow : true;
    return { ...acc, [tab]: isActive };
  }, {});
};

const scrollToTab = (tabPrefix, tabId) => {
  const el = document.querySelector(`#${tabPrefix}_${tabId}`);
  if (el && el.scrollIntoView) {
    el.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    });
  }
};

const getListingTypeConfig = (listing, selectedListingType, config) => {
  const existingListingType = listing?.attributes?.publicData?.listingType;
  const validListingTypes = config.listing.listingTypes;
  const hasOnlyOneListingType = validListingTypes?.length === 1;

  const listingTypeConfig = existingListingType
    ? validListingTypes.find(conf => conf.listingType === existingListingType)
    : selectedListingType
    ? validListingTypes.find(conf => conf.listingType === selectedListingType.listingType)
    : hasOnlyOneListingType
    ? validListingTypes[0]
    : null;
  return listingTypeConfig;
};

/**
 * EditListingWizard is a component that renders the tabs that update the different parts of the listing.
 * It also handles the payout details modal and the Flutterwave subaccount form if the listing is a new one.
 * TODO: turn this into a functional component
 *
 * @component
 * @param {Object} props - The props object
 * @param {string} props.id - The id of the listing
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {Object} props.config - The config object
 * @param {Object} props.routeConfiguration - The route configuration object
 * @param {Object} props.params - The params object
 * @param {string} props.params.id - The id of the listing
 * @param {string} props.params.slug - The slug of the listing
 * @param {'new'|'draft'|'edit'} props.params.type - The type of the listing
 * @param {DETAILS | PRICING | PRICING_AND_STOCK | DELIVERY | LOCATION | AVAILABILITY | PHOTOS} props.params.tab - The name of the tab
 * @param {propTypes.ownListing} props.listing - The listing object
 * @param {propTypes.error} [props.errors.createListingDraftError] - The error object for createListingDraft
 * @param {propTypes.error} [props.errors.publishListingError] - The error object for publishListing
 * @param {propTypes.error} [props.errors.updateListingError] - The error object for updateListing
 * @param {propTypes.error} [props.errors.showListingsError] - The error object for showListings
 * @param {propTypes.error} [props.errors.uploadImageError] - The upload image error object
 * @param {propTypes.error} [props.errors.addExceptionError] - The error object for addException
 * @param {propTypes.error} [props.errors.deleteExceptionError] - The error object for deleteException
 * @param {propTypes.error} [props.errors.setStockError] - The error object for setStock
 * @param {boolean} props.fetchInProgress - Whether the fetch is in progress
 * @param {boolean} props.payoutDetailsSaveInProgress - Whether the payout details save is in progress
 * @param {boolean} props.payoutDetailsSaved - Whether the payout details saved is in progress
 * @param {Function} props.onPayoutDetailsChange - The on payout details change function
 * @param {Function} props.onPayoutDetailsSubmit - The on payout details submit function
 * @param {Function} props.onManageDisableScrolling - The on manage disable scrolling function
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element} EditListingWizard component
 */
class EditListingWizard extends Component {
  constructor(props) {
    super(props);

    // Having this info in state would trigger unnecessary rerendering
    this.hasScrolledToTab = false;

    this.state = {
      draftId: null,
      showPayoutDetails: false,
      selectedListingType: null,
      mounted: false,
    };
    this.handleCreateFlowTabScrolling = this.handleCreateFlowTabScrolling.bind(this);
    this.handlePublishListing = this.handlePublishListing.bind(this);
    this.handlePayoutModalClose = this.handlePayoutModalClose.bind(this);
  }

  componentDidMount() {
    if (!this.mounted) {
      this.mounted = true;
    }
  }

  handleCreateFlowTabScrolling(shouldScroll) {
    this.hasScrolledToTab = shouldScroll;
  }

  handlePublishListing(id) {
    const { onPublishListingDraft, listing, config, subaccount } = this.props;
    const processName = listing?.attributes?.publicData?.transactionProcessAlias.split('/')[0];
    const isInquiryProcess = processName === INQUIRY_PROCESS_NAME;

    const listingTypeConfig = getListingTypeConfig(listing, this.state.selectedListingType, config);
    // Through hosted configs (listingTypeConfig.defaultListingFields?.payoutDetails),
    // it's possible to publish listing without payout details set by provider.
    // Customers can't purchase these listings - but it gives operator opportunity to discuss with providers who fail to do so.
    const isPayoutDetailsRequired = requirePayoutDetails(listingTypeConfig);

    const flutterwaveConnected = !!subaccount;
    console.log({ flutterwaveConnected, subaccount });
    if (isInquiryProcess || !isPayoutDetailsRequired || flutterwaveConnected) {
      onPublishListingDraft(id);
    } else {
      this.setState({
        draftId: id,
        showPayoutDetails: true,
      });
    }
  }

  handlePayoutModalClose() {
    this.setState({ showPayoutDetails: false });
  }

  render() {
    const {
      id,
      className,
      rootClassName,
      params,
      listing,
      intl,
      errors,
      fetchInProgress,
      payoutDetailsSaveInProgress,
      payoutDetailsSaved,
      onManageDisableScrolling,
      onPayoutDetailsChange,
      currentUser,
      config,
      routeConfiguration,
      authScopes,
      subaccountFetched,
      flutterwaveSubaccountError,
      createSubaccountError,
      ...rest
    } = this.props;

    const selectedTab = params.tab;
    const isNewListingFlow = [LISTING_PAGE_PARAM_TYPE_NEW, LISTING_PAGE_PARAM_TYPE_DRAFT].includes(
      params.type
    );
    const rootClasses = rootClassName || css.root;
    const classes = classNames(rootClasses, className);
    const currentListing = ensureListing(listing);
    const savedProcessAlias = currentListing.attributes?.publicData?.transactionProcessAlias;
    const transactionProcessAlias =
      savedProcessAlias || this.state.selectedListingType?.transactionProcessAlias;

    // NOTE: If the listing has invalid configuration in place,
    // the listing is considered deprecated and we don't allow user to modify the listing anymore.
    // Instead, operator should do that through Console or Integration API.
    const validListingTypes = config.listing.listingTypes;
    const listingTypeConfig = getListingTypeConfig(
      currentListing,
      this.state.selectedListingType,
      config
    );
    const existingListingType = currentListing.attributes?.publicData?.listingType;
    const invalidExistingListingType = existingListingType && !listingTypeConfig;
    // TODO: displayPrice aka config.defaultListingFields?.price with false value is only available with inquiry process
    //       if it's enabled with other processes, translations for "new" flow needs to be updated.
    const isPriceDisabled = !displayPrice(listingTypeConfig);

    // Transaction process alias is used here, because the process defineds whether the listing is supported
    // I.e. old listings might not be supported through listing types, but client app might still support those processes.
    const processName = transactionProcessAlias
      ? transactionProcessAlias.split('/')[0]
      : validListingTypes.length === 1
      ? validListingTypes[0].transactionType.process
      : INQUIRY_PROCESS_NAME;

    const hasListingTypeSelected =
      existingListingType || this.state.selectedListingType || validListingTypes.length === 1;

    // For oudated draft listing, we don't show other tabs but the "details"
    const tabs =
      isNewListingFlow && (invalidExistingListingType || !hasListingTypeSelected)
        ? TABS_DETAILS_ONLY
        : tabsForListingType(processName, listingTypeConfig);

    // Check if wizard tab is active / linkable.
    // When creating a new listing, we don't allow users to access next tab until the current one is completed.
    const tabsStatus = tabsActive(isNewListingFlow, currentListing, tabs, config);

    // Redirect user to first tab when encoutering outdated draft listings.
    if (invalidExistingListingType && isNewListingFlow && selectedTab !== tabs[0]) {
      return <NamedRedirect name="EditListingPage" params={{ ...params, tab: tabs[0] }} />;
    }

    // If selectedTab is not active for listing with valid listing type,
    // redirect to the beginning of wizard
    if (!invalidExistingListingType && !tabsStatus[selectedTab]) {
      const currentTabIndex = tabs.indexOf(selectedTab);
      const nearestActiveTab = tabs
        .slice(0, currentTabIndex)
        .reverse()
        .find(t => tabsStatus[t]);

      console.log(
        `You tried to access an EditListingWizard tab (${selectedTab}), which was not yet activated.`
      );
      return <NamedRedirect name="EditListingPage" params={{ ...params, tab: nearestActiveTab }} />;
    }

    const isBrowser = typeof window !== 'undefined';
    const hasMatchMedia = isBrowser && window?.matchMedia;
    const isMobileLayout = hasMatchMedia
      ? window.matchMedia(`(max-width: ${MAX_HORIZONTAL_NAV_SCREEN_WIDTH}px)`)?.matches
      : true;

    const hasHorizontalTabLayout = this.mounted && isMobileLayout;
    const hasVerticalTabLayout = this.mounted && !isMobileLayout;

    // Check if scrollToTab call is needed (tab is not visible on mobile)
    if (hasVerticalTabLayout) {
      this.hasScrolledToTab = true;
    } else if (hasHorizontalTabLayout && !this.hasScrolledToTab) {
      const tabPrefix = id;
      scrollToTab(tabPrefix, selectedTab);
      this.hasScrolledToTab = true;
    }

    const tabLink = tab => {
      return { name: 'EditListingPage', params: { ...params, tab } };
    };

    const ensuredCurrentUser = ensureCurrentUser(currentUser);
    const currentUserLoaded = !!ensuredCurrentUser.id;
    const privateData = ensuredCurrentUser?.attributes?.profile?.privateData || {};
    const flutterwaveSubaccount = privateData.flutterwaveSubaccount || {};
    const flutterwaveConnected = !!flutterwaveSubaccount.subaccountId;

    const {
      country: savedCountry,
      accountBank: savedAccountBank,
      accountNumber: savedAccountNumber,
      businessName: savedBusinessName,
      businessNumber: savedBusinessNumber,
    } = flutterwaveSubaccount;

    const { marketplaceName } = config;
    const payoutModalInfo = flutterwaveConnected ? (
      <FormattedMessage id="EditListingWizard.payoutModalInfo" values={{ marketplaceName }} />
    ) : (
      <FormattedMessage id="EditListingWizard.payoutModalInfoNew" values={{ marketplaceName }} />
    );

    return (
      <div className={classes}>
        <Tabs
          rootClassName={css.tabsContainer}
          navRootClassName={css.nav}
          tabRootClassName={css.tab}
          ariaLabel={intl.formatMessage({ id: 'EditListingWizard.screenreader.tabNavigation' })}
        >
          {tabs.map(tab => {
            const tabTranslations = tabLabelAndSubmit(
              intl,
              tab,
              isNewListingFlow,
              isPriceDisabled,
              resolveLatestProcessName(processName)
            );
            return (
              <EditListingWizardTab
                {...rest}
                key={tab}
                tabId={`${id}_${tab}`}
                tabLabel={tabTranslations.label}
                tabSubmitButtonText={tabTranslations.submitButton}
                tabLinkProps={tabLink(tab)}
                selected={selectedTab === tab}
                disabled={isNewListingFlow && !tabsStatus[tab]}
                tab={tab}
                params={params}
                listing={listing}
                marketplaceTabs={tabs}
                errors={errors}
                handleCreateFlowTabScrolling={this.handleCreateFlowTabScrolling}
                handlePublishListing={this.handlePublishListing}
                fetchInProgress={fetchInProgress}
                onListingTypeChange={selectedListingType => this.setState({ selectedListingType })}
                onManageDisableScrolling={onManageDisableScrolling}
                config={config}
                routeConfiguration={routeConfiguration}
                intl={intl}
              />
            );
          })}
        </Tabs>
        <Modal
          id="EditListingWizard.payoutModal"
          isOpen={this.state.showPayoutDetails}
          onClose={() => {
            this.handlePayoutModalClose();
            const main = document.getElementsByTagName('main')?.[0];
            const submitButtons = main?.querySelectorAll('button[type="submit"]');
            const lastSubmitButton = submitButtons?.[submitButtons.length - 1];
            if (lastSubmitButton) {
              lastSubmitButton.focus();
            }
          }}
          onManageDisableScrolling={onManageDisableScrolling}
          usePortal
        >
          <div className={css.modalPayoutDetailsWrapper}>
            <Heading as="h2" rootClassName={css.modalTitle}>
              <FormattedMessage id="EditListingWizard.payoutModalTitleOneMoreThing" />
              <br />
              <FormattedMessage id="EditListingWizard.payoutModalTitlePayoutPreferences" />
            </Heading>
            {!currentUserLoaded ? (
              <FormattedMessage id="EditListingWizard.payoutModalLoadingData" />
            ) : (
              <>
                <p className={css.modalMessage}>{payoutModalInfo}</p>
                <FlutterwaveSubaccountForm
                  disabled={fetchInProgress}
                  inProgress={payoutDetailsSaveInProgress}
                  ready={payoutDetailsSaved}
                  currentUser={currentUser}
                  savedCountry={savedCountry}
                  savedAccountBank={savedAccountBank}
                  savedAccountNumber={savedAccountNumber}
                  savedBusinessName={savedBusinessName}
                  savedBusinessNumber={savedBusinessNumber}
                  submitButtonText={intl.formatMessage({
                    id: 'EditListingWizard.payoutModalSubmitButtonText',
                  })}
                  flutterwaveSubaccountError={createSubaccountError ?? flutterwaveSubaccountError}
                  flutterwaveSubaccountFetched={subaccountFetched}
                  onChange={onPayoutDetailsChange}
                  onSubmit={async values => {
                    const response = await rest.onPayoutDetailsSubmit(values);
                    console.log({ response });
                    if (response.error) {
                      return;
                    }
                    this.handlePayoutModalClose();
                    const main = document.getElementsByTagName('main')?.[0];
                    const submitButtons = main?.querySelectorAll('button[type="submit"]');
                    const lastSubmitButton = submitButtons?.[submitButtons.length - 1];
                    if (lastSubmitButton) {
                      lastSubmitButton.focus();
                    }
                  }}
                  flutterwaveConnected={flutterwaveConnected}
                  authScopes={authScopes}
                />
              </>
            )}
          </div>
        </Modal>
      </div>
    );
  }
}

const EnhancedEditListingWizard = props => {
  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();
  return (
    <EditListingWizard
      config={config}
      routeConfiguration={routeConfiguration}
      intl={intl}
      {...props}
    />
  );
};

export default EnhancedEditListingWizard;
