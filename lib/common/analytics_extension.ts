import { AcsRequest, CpeResponse, DeviceData, GetParameterNames, GetParameterValues, SessionContext } from "../types";
import * as logger from "../logger";
import Path from "./path";
import * as device from "../device";
import * as db from "../db";
//import analytics_stage_data from "./genieacs_analytics"


let generateArguments: any = null;
try {
  generateArguments = require("/opt/genieacs/analytics/generated_arguments.js")
// eslint-disable-next-line no-empty
}catch(e){
  logger.accessWarn({
    message: JSON.stringify(e),
  });
}


export async function processAnalytics(
  sessionContext: SessionContext,
): Promise<AcsRequest | null>{
  sessionContext.debug = true

  if(sessionContext.analyticsStorage === undefined)
    sessionContext.analyticsStorage = {};

  if(sessionContext.analyTicsIteation === undefined)
    sessionContext.analyTicsIteation = 0;


  const log = (message: string): void => {
    logger.accessWarn({
      sessionContext: sessionContext,
      message: message,
    });
  }

  // Fetches for lastAnalyticsRun virtual parameter
  if(sessionContext.previousAnalyticsRun === undefined)
    sessionContext.previousAnalyticsRun = await db.getAnalyticsTimestamp(sessionContext.deviceId) 

  const context = {
    analyTicsIteation: sessionContext.analyTicsIteation,
    deviceId: sessionContext.deviceId,
    cpeResponse: sessionContext.cpeResponse,
    previousAnalyticsRunTimestamp: sessionContext.previousAnalyticsRun,
    sessionTimestamp: sessionContext.timestamp,
    log: log,
    generateGetParameterNames: generateGetParameterNames,
    genetrateGetParameterValues: genetrateGetParameterValues,

  }

  let nextIterationOfGetValues = null;
  
  if(generateArguments)
    nextIterationOfGetValues = generateArguments(context)
  
  // No more ite
  if(nextIterationOfGetValues === null || nextIterationOfGetValues === undefined){
    // If analytics iteration is 0 means no new data was collected during analytics
    // processing
    if(sessionContext.analyTicsIteation === 0)
      return null;

    // update last analytics session
    if(sessionContext.previousAnalyticsRun !== sessionContext.timestamp){
      db.saveAnalyticsTimestamp(sessionContext.deviceId, sessionContext.timestamp)
    }
      
    //void exportCurrentDeviceData(sessionContext.deviceData)
    return null;
  }


  sessionContext.analyTicsIteation += 1;
  return nextIterationOfGetValues
}

function generateGetParameterNames(parameterPath: string, nextLevel: boolean): GetParameterNames{
  return {
    name: "GetParameterNames",
    parameterPath: parameterPath,
    nextLevel: nextLevel,
  }
}

function genetrateGetParameterValues(paths: string[]): GetParameterValues{
  return {
    name: "GetParameterValues",
    parameterNames: paths,
  }
}
/*
const pathList = [
  "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Channel",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Standard",
  "InternetGatewayDevice.LANDevice.\\d+.Hosts.Host.\\d+.MACAddress",
  "InternetGatewayDevice.LANDevice.\\d+.Hosts.Host.\\d+.Active",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevi\ce.\\d+.AssociatedDeviceMACAddress",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.BytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.BytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.Stats.DropPackets",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.TransceiverTemperature",
  "InternetGatewayDevice.WANDevice.\\d+.X_GponInterafceConfig.Stats.ErrorRate",
  "InternetGatewayDevice.DeviceInfo.X_HW_MemUsed",
  "InternetGatewayDevice.DeviceInfo.X_HW_CpuUsed",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.X_HW_Standard",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_HW_SNR",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_HW_RSSI",
  "InternetGatewayDevice.LANDevice.\\d+.Hosts.Host.\\d+.X_HW_RSSI",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.DeviceInfo.MemoryStatus.Free",
  "InternetGatewayDevice.DeviceInfo.MemoryStatus.Total",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsSent",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.Stats.BytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.Stats.BytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.Stats.DropPackets",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.TransceiverTemperature",
  "InternetGatewayDevice.WANDevice.\\d+.X_ZTE-COM_WANPONInterfaceConfig.Stats.ErrorRate",
  "InternetGatewayDevice.DeviceInfo.X_ZTE-COM_MemUsed",
  "InternetGatewayDevice.DeviceInfo.X_ZTE-COM_CpuUsed",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.X_HW_Standard",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_HW_SNR",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_ZTE-COM_RSSI",
  "InternetGatewayDevice.LANDevice.\\d+.Hosts.Host.\\d+.X_ZTE-COM_RSSI",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsSent",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.BytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.BytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.Stats.DropPackets",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.TransceiverTemperature",
  "InternetGatewayDevice.WANDevice.\\d+.X_FH_GponInterfaceConfig.Stats.ErrorRate",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.SignalStrength",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.OperatingStandard",
  "InternetGatewayDevice.X_ALU_OntOpticalParam.TransceiverTemperature",
  "InternetGatewayDevice.DeviceInfo.MemoryStatus.Free",
  "InternetGatewayDevice.DeviceInfo.MemoryStatus.Total",
  "InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
  "InternetGatewayDevice.X_ALU_OntOpticalParam.TXPower",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.DeviceInfo.MemoryStatus.Free",
  "InternetGatewayDevice.DeviceInfo.MemoryStatus.Total",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_TP_StaSignalStrength",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetBytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetBroadcastPacketsSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANEthernetInterfaceConfig.Stats.BytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANEthernetInterfaceConfig.Stats.BytesSent",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetDiscardPacketsReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetDiscardPacketsSentt",
  "InternetGatewayDevice.WANDevice.\\d+.WANEthernetInterfaceConfig.Stats.BytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANEthernetInterfaceConfig.Stats.BytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.X_TP_WANUSB3gLinkConfig.SignalStrength",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.X_TP_WDSBridge.BridgeRSSI",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_TP_StaSignalStrength",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.AssociatedDevice.\\d+.X_TP_StaSignalStrength",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsReceived",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.Stats.DiscardPacketsSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.WANDevice.\\d+.WANEthernetInterfaceConfig.Stats.BytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANEthernetInterfaceConfig.Stats.BytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetDiscardPacketsReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetDiscardPacketsSent",
  "InternetGatewayDevice.LANDevice.\\d+.WLANConfiguration.\\d+.X_TP_WDSBridge.BridgeRSSI",
  "InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.DownloadDiagnostics.TotalBytesReceived",
  "InternetGatewayDevice.DownloadDiagnostics.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.DeviceInfo.UpTime",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANCommonInterfaceConfig.TotalBytesSent",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetDiscardPacketsReceived",
  "InternetGatewayDevice.WANDevice.\\d+.WANConnectionDevice.\\d+.WANPPPConnection.\\d+.Stats.EthernetDiscardPacketsSent",
]

const pathListRegexMatcher = new RegExp(pathList.join("|"))


function generateArguments(analyTicsIteation, deviceId, cpeResponse: CpeResponse | any, log: (message: string) => void): AcsRequest | null{
  const desiredParameterValues = []
  const analyticsExportValuyes = []
  switch (analyTicsIteation) {
    case 0:
      return generateGetParameterNames("InternetGatewayDevice.", false)
      break;
    case 1:
      cpeResponse.parameterList.forEach(parameter => {
        const path = parameter[0].toString()
        
        if(path.match(pathListRegexMatcher)){
          log(`Adding parameter: ${path}`);
          desiredParameterValues.push(path)
        }
      });

      

      return genetrateGetParameterValues(desiredParameterValues)
      break;      
    default:
      cpeResponse.parameterList.forEach(parameter => {
        const path = parameter[0].toString()
        analyticsExportValuyes.push({path: path, value: parameter[1]})
      })
      
      log(`Exported paths: ${JSON.stringify(analyticsExportValuyes)}`);

      //if(typeof analytics_stage_data === 'function'){
      //  analytics_stage_data(analyticsExportValuyes)
      //  logger.accessWarn({
      //    sessionContext: sessionContext,
      //    message: `Called Function`,
      //  });
      //}
      return null;
      break;
  }

}
*/
