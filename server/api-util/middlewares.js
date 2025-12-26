const { denormalisedResponseEntities } = require('./format');
const { getSdk, handleError } = require('./sdk');

const auth = async (req, res, next) => {
  try {
    const sdk = getSdk(req, res);

    const response = await sdk.currentUser.show({ expand: true });
    const [currentUser] = denormalisedResponseEntities(response);
    if (!currentUser) {
      const error = new Error('Unauthorized');
      error.status = 401;
      error.statusText = 'Unauthorized';
      error.data = { message: 'Unauthorized' };
      throw error;
    }
    req.currentUser = currentUser;
    next();
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = { auth };
