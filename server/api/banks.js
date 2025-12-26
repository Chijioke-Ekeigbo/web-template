const { getFlutterwaveApi } = require('../api-util/flutterwaveSdk');
const { serialize, handleError } = require('../api-util/sdk');

// POST /api/banks
// Body: { country }
module.exports = async (req, res) => {
  try {
    const { country } = req.body || {};

    if (!country) {
      return res.status(400).json({
        error: 'Country parameter is required',
      });
    }

    // Fetch banks from Flutterwave API
    const flutterwaveApi = getFlutterwaveApi();
    const response = await flutterwaveApi.get(`/banks/${country}`);
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
