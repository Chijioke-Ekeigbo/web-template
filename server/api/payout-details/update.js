const { getFlutterwaveApi } = require('../../api-util/flutterwaveSdk');
const { serialize, handleError, getSdk } = require('../../api-util/sdk');

// Update subaccount
const updatePayoutDetails = async (req, res) => {
  try {
    const { accountNumber, businessName } = req.body;
    const sdk = getSdk(req, res);
    const currentUser = req.currentUser;
    const flutterwaveSubaccountId =
      currentUser.attributes.profile.privateData.flutterwaveSubaccount?.id;

    if (!flutterwaveSubaccountId) {
      const error = new Error('flutterwaveSubaccountId is required');
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = { message: 'flutterwaveSubaccountId is required' };
      throw error;
    }

    const payload = {};
    if (accountNumber) payload.account_number = accountNumber;
    if (businessName) payload.business_name = businessName;

    if (Object.keys(payload).length === 0) {
      const error = new Error(
        'At least one field (account_number, business_name) must be provided'
      );
      error.status = 400;
      error.statusText = 'Bad Request';
      error.data = {
        message: 'At least one field (account_number, business_name) must be provided',
      };
      throw error;
    }
    const flutterwaveApi = getFlutterwaveApi();
    await flutterwaveApi.put(`/subaccounts/${flutterwaveSubaccountId}`, payload);

    const updateProfileResponse = await sdk.currentUser.updateProfile(
      {
        privateData: {
          flutterwaveSubaccount: {
            ...currentUser.attributes.profile.privateData.flutterwaveSubaccount,
            accountNumber,
            businessName,
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

module.exports = updatePayoutDetails;
