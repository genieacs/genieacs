/*
The scripts in this directory are loaded by genieacs along with the provision
script. Configure genieacs' cwmp server parameter EXT_DIR to the following:
"path/to/flashman/controllers/external-genieacs"
*/
/**
 * This file includes functions to handle the interact with GenieACS and
 * Flashman. Be aware that those functions might be accessible for Flashman
 * in a Docker environment.
 * @namespace controllers/external-genieacs/devices-api
 */

// ***** WARNING!!! *****
// DO NOT CHANGE THIS VARIABLE WITHOUT ALSO CHANGING THE COMMAND THAT ALTERS IT
// IN CONTROLLERS/UPDATE_FLASHMAN.JS! THIS LINE IS ALTERED AUTOMATICALLY WHEN
// FLASHMAN IS RESTARTED FOR ANY REASON
const INSTANCES_COUNT = 1;
/* This file is called by genieacs-cwmp, so need to set FLM_WEB_PORT in
 environment.genieacs.json or in shell environment with the same value
 that is in environment.config.json */
const FLASHMAN_PORT = (process.env.FLM_WEB_PORT || 8000);
const API_URL = 'http://'+(process.env.FLM_WEB_HOST || 'localhost')
  +':$PORT/acs/';

const request = require('request');


let cacheDeviceFieldsIDX = '';
let cacheDeviceFieldsDATA = {};
const getDeviceFields = async function(args, callback) {
  let params = null;
  let callidx = 0;

  // If callback not defined, define a simple one
  if (!callback) {
    callback = (arg1, arg2) => {
      return arg2;
    };
  }

  try {
    callidx = args[1];
    params = JSON.parse(args[0]);
  } catch (error) {
    return callback(null, {
      success: false,
      message: 'Error parsing params JSON',
      reason: 'params-json-parse',
    });
  }

  // Avoid call to flashman twice from provision
  if (cacheDeviceFieldsIDX === callidx) {
    return callback(null, cacheDeviceFieldsDATA);
  }

  if (!params || !params.oui || !params.model) {
    cacheDeviceFieldsIDX = callidx;
    cacheDeviceFieldsDATA = {
      success: false,
      message: 'Incomplete arguments',
      reason: 'incomplete-params',
    };
    return callback(null, cacheDeviceFieldsDATA);
  }

  let flashRes = await sendFlashmanRequest('POST', 'device/inform', params);
  if (!flashRes['success'] ||
      Object.prototype.hasOwnProperty.call(flashRes, 'measure')) {
    cacheDeviceFieldsIDX = callidx;
    cacheDeviceFieldsDATA = flashRes;
    return callback(null, cacheDeviceFieldsDATA);
  }

  cacheDeviceFieldsIDX = callidx;
  cacheDeviceFieldsDATA = {
    success: true,
    fields: flashRes.data.fields,
    measure: flashRes.data.measure,
    commands: flashRes.data.commands,
    blockedDevices: flashRes.data.blockedDevices,
    forceUpdate: flashRes.data.forceUpdate,
    bootstrapCheckValue: flashRes.data.bootstrapCheckValue,
    permissions: flashRes.data.permissions,
    shouldRunRegularProvision: flashRes.data.shouldRunRegularProvision,
    shouldRunBootstrapSync: flashRes.data.shouldRunBootstrapSync,
    executeConfigFile: flashRes.data.executeConfigFile,
    configFilename: flashRes.data.configFilename,
  };
  callback(null, cacheDeviceFieldsDATA);
};


let cacheDeviceModelFieldsIDX = '';
let cacheDeviceModelFieldsDATA = {};
const getDeviceModelFields = async function(args, callback) {
  let params = null;
  let callidx = 0;

  // If callback not defined, define a simple one
  if (!callback) {
    callback = (arg1, arg2) => {
      return arg2;
    };
  }

  try {
    callidx = args[1];
    params = JSON.parse(args[0]);
  } catch (error) {
    return callback(null, {
      success: false,
      message: 'Incomplete arguments',
    });
  }

  // Avoid call to flashman twice from provision
  if (cacheDeviceModelFieldsIDX === callidx) {
    return callback(null, cacheDeviceModelFieldsDATA);
  }

  if (!params || !params.oui || !params.model) {
    cacheDeviceModelFieldsIDX = callidx;
    cacheDeviceModelFieldsDATA = {
      success: false,
      message: 'Incomplete arguments',
    };
    return callback(null, cacheDeviceModelFieldsDATA);
  }

  const fieldsResult = await sendFlashmanRequest(
    'GET',
    `oui/${params.oui}/` +
    `model/${params.model}/` +
    `model-name/${params.modelName}/` +
    `hardware/${params.hardwareVersion}/` +
    `firmware/${params.firmwareVersion}/` +
    `tr-type/${params.trType}/` +
    'model-fields',
    {},
  );
  if (
    !fieldsResult['success'] || !fieldsResult.data || !fieldsResult.data.fields
  ) {
    cacheDeviceModelFieldsIDX = callidx;
    cacheDeviceModelFieldsDATA = fieldsResult;
    return callback(null, cacheDeviceModelFieldsDATA);
  }

  cacheDeviceModelFieldsIDX = callidx;
  cacheDeviceModelFieldsDATA = {
    success: true,
    fields: fieldsResult.data.fields,
  };
  callback(null, cacheDeviceModelFieldsDATA);
};


let cacheCheckNeedConfigurationFileIDX = '';
let cacheCheckNeedConfigurationFileDATA = {};
/**
 * Calls Flashman to check if the device needs a configuration file.
 *
 * @param {array<object|string>} args - Array of objects with the arguments.
 * @param {function|undefined} callback - Callback function.
 *
 * @return {any} - The result of the callback called with the result of what
 * Flashman returns after the call or an object with success and message.
 */
const checkNeedConfigurationFile = async function(args, callback) {
  let params;
  let callidx = 0;

  // If callback not defined, define a simple one
  if (!callback) {
    callback = (_arg1, arg2) => {
      return arg2;
    };
  }

  // Try to parse the arguments
  try {
    params = JSON.parse(args[0]);
    callidx = args[1];
  } catch (error) {
    const toReturn = {
      success: false,
      message: 'Invalid JSON',
    };
    return callback(null, toReturn);
  }

  // Avoid call to flashman twice from provision, check if data is valid
  if (
    cacheCheckNeedConfigurationFileIDX === callidx &&
    cacheCheckNeedConfigurationFileDATA &&
    cacheCheckNeedConfigurationFileDATA.message
  ) {
    return callback(null, cacheCheckNeedConfigurationFileDATA);
  }

  // Check if params is valid
  if (!params || !params.oui || !params.model) {
    const toReturn = {
      success: false,
      message: 'Incomplete arguments',
    };
    return callback(null, toReturn);
  }

  // Call Flashman
  let response = await sendFlashmanRequest(
    'POST', 'device/checkConfigurationFile', params,
  );

  if (!response || !response.data) {
    cacheCheckNeedConfigurationFileIDX = callidx;
    cacheCheckNeedConfigurationFileDATA = {
      success: false,
      message: 'Error contacting Flashman',
      shouldRunRegularProvision: false,
      configFilename: '',
      checkWan: false,
      executeConfigFile: false,
    };
    return callback(null, cacheCheckNeedConfigurationFileDATA);
  }

  cacheCheckNeedConfigurationFileIDX = callidx;
  cacheCheckNeedConfigurationFileDATA = {
    success: true,
    message: 'OK',
    shouldRunRegularProvision: response.data.shouldRunRegularProvision,
    configFilename: response.data.configFilename,
    executeConfigFile: response.data.executeConfigFile,
    checkWan: response.data.checkWan,
  };
  return callback(null, cacheCheckNeedConfigurationFileDATA);
};


let cacheCheckNeedConfigurationFileOnWANIDX = '';
let cacheCheckNeedConfigurationFileOnWANDATA = {};
/**
 * Calls Flashman to check if the device needs a configuration file based on WAN
 * changes.
 *
 * @param {array<object|string>} args - Array of objects with the arguments.
 * @param {function|undefined} callback - Callback function.
 *
 * @return {any} - The result of the callback called with the result of what
 * Flashman returns after the call or an object with success and message.
 */
const checkNeedConfigurationFileOnWAN = async function(args, callback) {
  let params;
  let callidx = 0;

  // If callback not defined, define a simple one
  if (!callback) {
    callback = (_arg1, arg2) => {
      return arg2;
    };
  }

  // Try to parse the arguments
  try {
    params = JSON.parse(args[0]);
    callidx = args[1];
  } catch (error) {
    const toReturn = {
      success: false,
      message: 'Invalid JSON',
    };
    return callback(null, toReturn);
  }

  // Avoid call to flashman twice from provision, check if data is valid
  if (
    cacheCheckNeedConfigurationFileOnWANIDX === callidx &&
    cacheCheckNeedConfigurationFileOnWANDATA &&
    cacheCheckNeedConfigurationFileOnWANDATA.message
  ) {
    return callback(null, cacheCheckNeedConfigurationFileOnWANDATA);
  }

  // Check if params is valid
  if (!params || !params.oui || !params.model) {
    const toReturn = {
      success: false,
      message: 'Incomplete arguments',
    };
    return callback(null, toReturn);
  }

  // Call Flashman
  let response = await sendFlashmanRequest(
    'POST', 'device/checkConfigurationFileOnWAN', params,
  );

  if (!response || !response.data) {
    cacheCheckNeedConfigurationFileOnWANIDX = callidx;
    cacheCheckNeedConfigurationFileOnWANDATA = {
      success: false,
      message: 'Error contacting Flashman',
      executeConfigFile: false,
    };
    return callback(null, cacheCheckNeedConfigurationFileOnWANDATA);
  }

  cacheCheckNeedConfigurationFileOnWANIDX = callidx;
  cacheCheckNeedConfigurationFileOnWANDATA = {
    success: true,
    message: 'OK',
    executeConfigFile: response.data.executeConfigFile,
  };
  return callback(null, cacheCheckNeedConfigurationFileOnWANDATA);
};


const computeFlashmanUrl = function(shareLoad=true) {
  let url = API_URL;
  let numInstances = INSTANCES_COUNT;
  // Only used at scenarios where Flashman was installed directly on a host
  // without docker and with more than 1 vCPU
  if (shareLoad && numInstances > 1) {
    // More than 1 instance - share load between instances 1 and N-1
    // We ignore instance 0 for the same reason we ignore it for router syn
    // Instance 0 will be at port FLASHMAN_PORT, instance i will be at
    // FLASHMAN_PORT+i
    let target = Math.floor(Math.random()*(numInstances-1)) + FLASHMAN_PORT + 1;
    url = url.replace('$PORT', target.toString());
  } else {
    // Only 1 instance - force on instance 0
    url = url.replace('$PORT', FLASHMAN_PORT.toString());
  }
  return url;
};

const sendFlashmanRequest = function(method, route, params, shareLoad=true) {
  return new Promise((resolve, reject)=>{
    let url = computeFlashmanUrl(shareLoad);
    request({
      url: url + route,
      method: method,
      json: params,
    },
    function(error, response, body) {
      if (error) {
        return resolve({
          success: false,
          reason: 'flashman-contact',
          message: 'Error contacting Flashman',
        });
      }
      if (response.statusCode === 200) {
        if (body.success) {
          return resolve({success: true, data: body});
        } else if (body.message) {
          return resolve({
            success: false,
            reason: (body.reason) ? body.reason : 'flashman-error',
            message: body.message,
          });
        } else {
          return resolve({
            success: false,
            reason: (body.reason) ? body.reason : 'flashman-error',
            message: (body.message) ? body.message : 'Flashman internal error',
          });
        }
      } else {
        return resolve({
          success: false,
          reason: (body.reason) ? body.reason : 'flashman-error',
          message: (body.message) ? body.message : 'Error in Flashman request',
        });
      }
    });
  });
};

let cacheSyncDeviceIDX = '';
let cacheSyncDeviceDATA = {};
const syncDeviceData = async function(args, callback) {
  let params;
  let callidx;

  try {
    callidx = args[1];
    params = JSON.parse(args[0]);
  } catch (error) {
    return callback(null, {
      success: false,
      reason: 'params-json-parse',
      message: 'Error parsing params JSON',
    });
  }

  // Avoid call to flashman twice from provision
  if (cacheSyncDeviceIDX === callidx) {
    return callback(null, cacheSyncDeviceDATA);
  }

  if (!params || !params.data || !params.acs_id) {
    cacheSyncDeviceIDX = callidx;
    cacheSyncDeviceDATA = {
      success: false,
      reason: 'incomplete-params',
      message: 'Incomplete arguments',
    };
    return callback(null, cacheSyncDeviceDATA);
  }
  let result = await sendFlashmanRequest('POST', 'device/syn', params);
  cacheSyncDeviceIDX = callidx;
  cacheSyncDeviceDATA = result;
  callback(null, cacheSyncDeviceDATA);
};

const syncDeviceDiagnostics = async function(args, callback) {
  let params = JSON.parse(args[0]);

  if (!params || !params.acs_id) {
    return callback(null, {
      success: false,
      message: 'Incomplete arguments',
    });
  }
  let result = await sendFlashmanRequest(
    'POST', 'receive/diagnostic', params, false,
  );
  callback(null, result);
};

let cacheDeleteTaskCallbackIDX = '';
let cacheDeleteTaskCallbackDATA = {};
const deleteTaskCallbacks = async function(args, callback) {
  let params = JSON.parse(args[0]);
  let callidx = args[1];

  // Avoid call to flashman twice from provision
  if (cacheDeleteTaskCallbackIDX === callidx) {
    return callback(null, cacheDeleteTaskCallbackDATA);
  }

  if (!params || !params.acs_id) {
    cacheDeleteTaskCallbackIDX = callidx;
    cacheDeleteTaskCallbackDATA = {
      success: false,
      message: 'Incomplete arguments',
    };
    return callback(null, cacheSyncDeviceDATA);
  }

  // Send an empty body because request is dumb and won't interpret result body
  // as json unless you sent a json yourself
  let result = await sendFlashmanRequest(
    'DELETE', `device/${params.acs_id}/taskCallbacks`, {},
  );
  cacheDeleteTaskCallbackIDX = callidx;
  cacheDeleteTaskCallbackDATA = result;
  callback(null, cacheDeleteTaskCallbackDATA);
};

let cacheGetMultiLanProvisionIDX = '';
let cacheGetMultiLanProvisionDATA = {};
const getMultiLanProvision = async function(args, callback) {
  let params = null;
  const callidx = args[1];

  try {
    params = JSON.parse(args[0]);
  } catch (error) {
    return callback(null, 0);
  }
  let routerid = params.routerid;

  // Avoid call to flashman twice from provision
  if (cacheGetMultiLanProvisionIDX === callidx) {
    return callback(null, cacheGetMultiLanProvisionDATA);
  }

  const result = await sendFlashmanRequest(
    'GET',
    `model/${routerid.model}/` +
    `model-name/${routerid.modelName}/` +
    `hardware/${routerid.hardwareVersion}/` +
    `firmware/${routerid.firmwareVersion}/` +
    `tr-type/${routerid.trType}/` +
    'lan-index',
    {
      requests: params.requests,
      associations: params.associations,
    },
  );

  let index = 0;
  if (result && result.success && result.data && result.data.index) {
    index = result.data.index;
  }

  cacheGetMultiLanProvisionIDX = callidx;
  cacheGetMultiLanProvisionDATA = index;
  callback(null, index);
};


/**
 * @exports controllers/external-genieacs/devices-api
 */

// Used on provisions
exports.getMultiLanProvision = getMultiLanProvision;
exports.getDeviceModelFields = getDeviceModelFields;
exports.checkNeedConfigurationFile = checkNeedConfigurationFile;
exports.checkNeedConfigurationFileOnWAN = checkNeedConfigurationFileOnWAN;
exports.deleteTaskCallbacks = deleteTaskCallbacks;
exports.getDeviceFields = getDeviceFields;
exports.syncDeviceData = syncDeviceData;
exports.syncDeviceDiagnostics = syncDeviceDiagnostics;
