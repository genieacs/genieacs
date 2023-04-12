import * as http from 'http'
import * as https from 'https'
import { InformRequest, SoapMessage } from './types';
import Path from './common/path';
import * as config from './config';

interface FlashmanResponse {
  success:boolean,
  measure:boolean
};

export const sendFlashmanInformRequest = async function (
  soapMessage:SoapMessage,
  parameters:any[],
): Promise<FlashmanResponse> {

  const parameterMap : any = {}
  const usedParameters = parameters.filter(
    (arr:any[])=> (arr.length>2) && (arr[2].value) 
  );
  for (const p of usedParameters) {
    const path = p[0] as Path;
    parameterMap[path.segments.join('.')] = p[2].value[1][0];
  }
  const informRequest = (soapMessage.cpeRequest as InformRequest);
  const body = {
    oui: informRequest.deviceId.OUI,
    model: informRequest.deviceId.ProductClass,
    modelName: parameterMap['InternetGatewayDevice.DeviceInfo.ModelName'],
    firmwareVersion: parameterMap['InternetGatewayDevice.DeviceInfo.SoftwareVersion'],
    hardwareVersion: parameterMap['InternetGatewayDevice.DeviceInfo.HardwareVersion'],
    acs_id: parameterMap['DeviceID.ID'],
  };
  const stringfiedBody = JSON.stringify(body);
  const flashmanUrl = config.get('CWMP_FLASHMAN_URL') as string;
  return new Promise((resolve,reject)=>{
    setTimeout(() => {
      reject(
        Error('POST on Flashman path "/acs/device/inform" timed out')
      )
    }, 10000);
    const scheme = flashmanUrl.startsWith('https') ? https : http;
    const req = scheme.request( flashmanUrl, {
      path: '/acs/device/inform',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': stringfiedBody.length,
      }
    }, (res) => {
      let data = '';
      res.on('error', (err) => {
        return reject(err);
      })
      res.on('data', (chunk) => {
        data += chunk;
      })
      res.on('end', () => {
        const responseBody = JSON.parse(data);
        if (res.statusCode<200 || res.statusCode>=300) {
          return reject(
            Error(`Flashman response from inform: ${res.statusCode}\n${responseBody}`)
          );
        } else {
          return resolve(responseBody);
        }
      })
    });
    req.on('error',reject);
    req.end(stringfiedBody);
  })
}
