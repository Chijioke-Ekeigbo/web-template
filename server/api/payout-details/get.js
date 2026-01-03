const { getFlutterwaveApi } = require('../../api-util/flutterwaveSdk');
const { serialize, handleError } = require('../../api-util/sdk');

// Get subaccount
const getPayoutDetails = async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const subaccountId = currentUser.attributes.profile.privateData.flutterwaveSubaccountId;
    const flutterwaveApi = getFlutterwaveApi();
    const response = await flutterwaveApi.get(`/subaccounts/${subaccountId}`);
    return res
      .status(200)
      .set('Content-Type', 'application/transit+json')
      .send(
        serialize({
          status: 200,
          statusText: 'OK',
          data: response.data.data,
        })
      )
      .end();
  } catch (error) {
    handleError(res, error);
  }
};

module.exports = getPayoutDetails;
