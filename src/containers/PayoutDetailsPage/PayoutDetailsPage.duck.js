import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import pick from 'lodash/pick';
import {
  createFlutterwaveSubaccount,
  setFlutterwaveSubaccount,
  updateFlutterwaveSubaccount,
} from '../../ducks/flutterwaveSubaccount.duck';
import { fetchCurrentUser, setCurrentUser } from '../../ducks/user.duck';
import { denormalisedResponseEntities } from '../../util/data';

// ================ Async thunks ================ //

const savePayoutDetailsPayloadCreator = (
  { values, isUpdateCall },
  { dispatch, extra: sdk, rejectWithValue }
) => {
  const upsertThunk = isUpdateCall ? updateFlutterwaveSubaccount : createFlutterwaveSubaccount;

  return dispatch(upsertThunk(values))
    .then(response => {
      const [currentUser] = denormalisedResponseEntities(response);
      dispatch(setCurrentUser(currentUser));
      return currentUser;
    })
    .catch(() => {
      return rejectWithValue('Failed to save payout details');
    });
};

export const savePayoutDetailsThunk = createAsyncThunk(
  'PayoutDetailsPage/savePayoutDetails',
  savePayoutDetailsPayloadCreator
);

// Backward compatible wrapper function
export const savePayoutDetails = (values, isUpdateCall) => dispatch => {
  return dispatch(savePayoutDetailsThunk({ values, isUpdateCall })).unwrap();
};

// ================ Slice ================ //

const initialState = {
  payoutDetailsSaveInProgress: false,
  payoutDetailsSaved: false,
  fromReturnURL: false,
};

const payoutDetailsPageSlice = createSlice({
  name: 'PayoutDetailsPage',
  initialState,
  reducers: {
    setInitialValues: (state, action) => {
      return { ...initialState, ...pick(action.payload, Object.keys(initialState)) };
    },
  },
  extraReducers: builder => {
    builder
      // Save Payout Details cases
      .addCase(savePayoutDetailsThunk.pending, state => {
        state.payoutDetailsSaveInProgress = true;
      })
      .addCase(savePayoutDetailsThunk.fulfilled, state => {
        state.payoutDetailsSaveInProgress = false;
        state.payoutDetailsSaved = true;
      })
      .addCase(savePayoutDetailsThunk.rejected, state => {
        state.payoutDetailsSaveInProgress = false;
      });
  },
});

// Export the action creators
export const { setInitialValues } = payoutDetailsPageSlice.actions;

export default payoutDetailsPageSlice.reducer;

// ================ Load Data ================ //

export const loadData = () => (dispatch, getState, sdk) => {
  // Clear state so that previously loaded data is not visible
  // in case this page load fails.
  dispatch(setInitialValues());
  const fetchCurrentUserOptions = {
    updateHasListings: false,
    updateNotifications: false,
  };

  return dispatch(fetchCurrentUser(fetchCurrentUserOptions)).then(response => {
    const currentUser = getState().user.currentUser;
    if (currentUser) {
      const privateData = currentUser.attributes.profile.privateData || {};
      if (privateData.flutterwaveSubaccount) {
        dispatch(setFlutterwaveSubaccount(privateData.flutterwaveSubaccount));
      }
    }
    return response;
  });
};
