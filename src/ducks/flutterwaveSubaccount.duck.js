// This file deals with Flutterwave subaccount management
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as log from '../util/log';
import { storableError } from '../util/errors';
import {
  getBanks as getBanksAPI,
  createPayoutDetails,
  updatePayoutDetails,
  getPayoutDetails,
} from '../util/api';
import { denormalisedResponseEntities } from '../util/data';

// ================ Async thunks ================ //

///////////////////////////
// Get Banks by Country //
///////////////////////////
const getBanksByCountryPayloadCreator = async (country, { extra: sdk, rejectWithValue }) => {
  try {
    const response = await getBanksAPI(country);
    return response.data || [];
  } catch (err) {
    const e = storableError(err);
    log.error(err, 'get-banks-by-country-failed');
    return rejectWithValue(e);
  }
};
export const getBanksByCountryThunk = createAsyncThunk(
  'flutterwaveSubaccount/getBanksByCountry',
  getBanksByCountryPayloadCreator
);
// Backward compatible wrapper function
export const getBanksByCountry = country => dispatch => {
  return dispatch(getBanksByCountryThunk(country)).unwrap();
};

///////////////////////////
// Create Flutterwave Subaccount //
///////////////////////////
const createFlutterwaveSubaccountPayloadCreator = async (
  params,
  { dispatch, extra: sdk, rejectWithValue }
) => {
  try {
    // Convert snake_case to camelCase for API

    const response = await createPayoutDetails(params);
    const entities = denormalisedResponseEntities(response);
    const [currentUser] = entities;

    return currentUser?.attributes?.profile?.privateData?.flutterwaveSubaccount || {};
  } catch (err) {
    const e = storableError(err);
    log.error(err, 'create-flutterwave-subaccount-failed');
    return rejectWithValue(e);
  }
};
export const createFlutterwaveSubaccountThunk = createAsyncThunk(
  'flutterwaveSubaccount/createFlutterwaveSubaccount',
  createFlutterwaveSubaccountPayloadCreator
);
// Backward compatible wrapper function
export const createFlutterwaveSubaccount = params => dispatch => {
  return dispatch(createFlutterwaveSubaccountThunk(params)).unwrap();
};

///////////////////////////
// Update Flutterwave Subaccount //
///////////////////////////
const updateFlutterwaveSubaccountPayloadCreator = async (
  params,
  { dispatch, extra: sdk, rejectWithValue }
) => {
  try {
    // Convert snake_case to camelCase for API
    const apiParams = {};
    if (params.accountNumber) apiParams.accountNumber = params.accountNumber;
    if (params.businessName) apiParams.businessName = params.businessName;

    const response = await updatePayoutDetails(apiParams);
    // Response is already deserialized Transit data
    // The API returns serialize(response.data.data) which is just the subaccount data
    const entities = denormalisedResponseEntities(response);
    const [currentUser] = entities;
    return currentUser?.attributes?.profile?.privateData?.flutterwaveSubaccount || {};
  } catch (err) {
    const e = storableError(err);
    log.error(err, 'update-flutterwave-subaccount-failed');
    return rejectWithValue(e);
  }
};
export const updateFlutterwaveSubaccountThunk = createAsyncThunk(
  'flutterwaveSubaccount/updateFlutterwaveSubaccount',
  updateFlutterwaveSubaccountPayloadCreator
);
// Backward compatible wrapper function
export const updateFlutterwaveSubaccount = params => dispatch => {
  return dispatch(updateFlutterwaveSubaccountThunk(params)).unwrap();
};

///////////////////////////
// Fetch Flutterwave Subaccount //
///////////////////////////
const fetchFlutterwaveSubaccountPayloadCreator = async (
  _,
  { dispatch, extra: sdk, rejectWithValue }
) => {
  try {
    const response = await getPayoutDetails();
    const entities = denormalisedResponseEntities(response);
    const [currentUser] = entities;
    return currentUser?.attributes?.profile?.privateData?.flutterwaveSubaccount || {};
  } catch (err) {
    const e = storableError(err);
    log.error(err, 'fetch-flutterwave-subaccount-failed');
    return rejectWithValue(e);
  }
};
export const fetchFlutterwaveSubaccountThunk = createAsyncThunk(
  'flutterwaveSubaccount/fetchFlutterwaveSubaccount',
  fetchFlutterwaveSubaccountPayloadCreator
);
// Backward compatible wrapper function
export const fetchFlutterwaveSubaccount = () => dispatch => {
  return dispatch(fetchFlutterwaveSubaccountThunk()).unwrap();
};

// ================ Slice ================ //

const flutterwaveSubaccountSlice = createSlice({
  name: 'flutterwaveSubaccount',
  initialState: {
    createSubaccountInProgress: false,
    createSubaccountError: null,
    updateSubaccountInProgress: false,
    updateSubaccountError: null,
    fetchSubaccountInProgress: false,
    fetchSubaccountError: null,
    getBanksInProgress: false,
    getBanksError: null,
    banks: [],
    subaccount: null,
    subaccountFetched: false,
  },
  reducers: {
    flutterwaveSubaccountClearError: state => {
      return {
        ...state,
        createSubaccountError: null,
        updateSubaccountError: null,
        fetchSubaccountError: null,
        getBanksError: null,
      };
    },
    setFlutterwaveSubaccount: (state, action) => {
      state.subaccount = action.payload;
      state.subaccountFetched = true;
    },
    clearBanks: state => {
      state.banks = [];
    },
  },
  extraReducers: builder => {
    builder
      // Get Banks cases
      .addCase(getBanksByCountryThunk.pending, state => {
        state.getBanksError = null;
        state.getBanksInProgress = true;
      })
      .addCase(getBanksByCountryThunk.fulfilled, (state, action) => {
        state.getBanksInProgress = false;
        state.banks = action.payload;
      })
      .addCase(getBanksByCountryThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.getBanksError = action.payload;
        state.getBanksInProgress = false;
      })
      // Create Subaccount cases
      .addCase(createFlutterwaveSubaccountThunk.pending, state => {
        state.createSubaccountError = null;
        state.createSubaccountInProgress = true;
      })
      .addCase(createFlutterwaveSubaccountThunk.fulfilled, (state, action) => {
        state.createSubaccountInProgress = false;
        state.subaccount = action.payload;
        state.subaccountFetched = true;
      })
      .addCase(createFlutterwaveSubaccountThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.createSubaccountError = action.payload;
        state.createSubaccountInProgress = false;
      })
      // Update Subaccount cases
      .addCase(updateFlutterwaveSubaccountThunk.pending, state => {
        state.updateSubaccountError = null;
        state.updateSubaccountInProgress = true;
      })
      .addCase(updateFlutterwaveSubaccountThunk.fulfilled, (state, action) => {
        state.updateSubaccountInProgress = false;
        state.subaccount = action.payload;
        state.subaccountFetched = true;
      })
      .addCase(updateFlutterwaveSubaccountThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.updateSubaccountError = action.payload;
        state.updateSubaccountInProgress = false;
      })
      // Fetch Subaccount cases
      .addCase(fetchFlutterwaveSubaccountThunk.pending, state => {
        state.fetchSubaccountError = null;
        state.fetchSubaccountInProgress = true;
      })
      .addCase(fetchFlutterwaveSubaccountThunk.fulfilled, (state, action) => {
        state.fetchSubaccountInProgress = false;
        state.subaccount = action.payload;
        state.subaccountFetched = true;
      })
      .addCase(fetchFlutterwaveSubaccountThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.fetchSubaccountError = action.payload;
        state.fetchSubaccountInProgress = false;
      });
  },
});

// Export the action creators
export const {
  flutterwaveSubaccountClearError,
  setFlutterwaveSubaccount,
  clearBanks,
} = flutterwaveSubaccountSlice.actions;

export default flutterwaveSubaccountSlice.reducer;
