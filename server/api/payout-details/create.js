const { getFlutterwaveApi } = require('../../api-util/flutterwaveSdk');
const { serialize, handleError, getSdk, fetchCommission } = require('../../api-util/sdk');

const createPayoutDetails = async (req, res) => {
  const currentUser = req.currentUser;
  const currentUserEmail = currentUser.attributes.email;
  const sdk = getSdk(req, res);
  try {
    const {
      accountBank,
      accountNumber,
      businessName,
      businessContact,
      businessContactMobile,
      businessMobile,
      country,
      businessNumber,
    } = req.body;

    // Validate required fields
    if (!accountBank || !accountNumber || !businessName || !country) {
      const missingFields = [];
      if (!accountBank) missingFields.push('accountBank');
      if (!accountNumber) missingFields.push('accountNumber');
      if (!businessName) missingFields.push('businessName');
      if (!country) missingFields.push('country');
      const error = new Error('Missing required fields');
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = { message: 'Missing required fields', missingFields: missingFields.join(', ') };
      throw error;
    }

    const commission = await fetchCommission(sdk);

    const commissionAsset = commission.data.data[0];

    const { providerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};
    const { percentage } = providerCommission;
    const payload = {
      account_bank: accountBank,
      account_number: accountNumber,
      business_name: businessName,
      country: country,
      business_email: currentUserEmail,
      business_contact: businessContact,
      business_contact_mobile: businessContactMobile,
      business_mobile: businessMobile,
      business_number: businessNumber,
      split_value: percentage / 100,
      split_type: 'percentage',
      meta: [
        {
          meta_name: 'Sharetribe User Id',
          meta_value: currentUser.id.uuid,
        },
        {
          meta_name: 'Sharetribe Marketplace',
          meta_value: process.env.REACT_APP_MARKETPLACE_NAME,
        },
      ],
    };

    const flutterwaveApi = getFlutterwaveApi();
    const response = await flutterwaveApi.post('/subaccounts', payload);

    const updateProfileResponse = await sdk.currentUser.updateProfile(
      {
        privateData: {
          flutterwaveSubaccount: {
            id: response.data.data.id,
            subaccountId: response.data.data.subaccount_id,
            accountBank,
            accountNumber,
            businessName,
            businessMobile,
            country,
            businessNumber,
          },
        },
      },
      { expand: true }
    );

    return res
      .status(200)
      .set('Content-Type', 'application/transit+json')
      .send(
        serialize({
          status: 200,
          statusText: 'OK',
          data: updateProfileResponse.data,
        })
      )
      .end();
  } catch (error) {
    handleError(res, error);
  }
};

module.exports = createPayoutDetails;
