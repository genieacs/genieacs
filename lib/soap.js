/**
 * Copyright 2013-2018  Zaid Abdulla
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */
"use strict";

const libxmljs = require("libxmljs");

const config = require("./config");

const SERVER_NAME = `GenieACS/${require("../package.json").version}`;

const NAMESPACES = {
  "1.0": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-0"
  },
  "1.1": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-1"
  },
  "1.2": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-2"
  },
  "1.3": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-2"
  },
  "1.4": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-3"
  }
};

const LIBXMLJS_PARSE_OPTIONS = {
  nocdata: true,
  recover: config.get("XML_RECOVER"),
  ignore_enc: config.get("XML_IGNORE_ENC")
};

const LIBXMLJS_SAVE_OPTIONS = {
  format: config.get("XML_FORMAT"),
  declaration: !config.get("XML_NO_DECL"),
  selfCloseEmpty: !config.get("XML_NO_EMPTY")
};

let warnings;

function parseBool(v) {
  v = "" + v;
  if (v === "true" || v === "TRUE" || v === "True" || v === "1") return true;
  else if (v === "false" || v === "FALSE" || v === "False" || v === "0")
    return false;
  else return null;
}

function event(xml) {
  return xml
    .childNodes()
    .filter(n => n.name() === "EventStruct")
    .map(c =>
      c
        .childNodes()
        .find(n => n.name() === "EventCode")
        .text()
        .trim()
    );
}

function parameterInfoList(xml) {
  return xml
    .childNodes()
    .filter(e => e.name() === "ParameterInfoStruct")
    .map(e => {
      let param, value;
      for (const c of e.childNodes()) {
        switch (c.name()) {
          case "Name":
            param = c.text();
            break;
          case "Writable":
            value = c.text();
            break;
        }
      }

      let parsed = parseBool(value);

      if (parsed === null) {
        warnings.push({
          message: "Invalid writable attribute",
          parameter: param
        });
        parsed = false;
      }

      return [param, parsed];
    });
}

function parameterValueList(xml) {
  return xml
    .childNodes()
    .filter(e => e.name() === "ParameterValueStruct")
    .map(e => {
      let valueElement, param;
      for (const c of e.childNodes()) {
        switch (c.name()) {
          case "Name":
            param = c.text();
            break;
          case "Value":
            valueElement = c;
            break;
        }
      }

      const valueType = valueElement.attr("type").value();
      const value = valueElement.text();
      let parsed = value;
      if (valueType === "xsd:boolean") {
        parsed = parseBool(value);
        if (parsed === null) {
          warnings.push({
            message: "Invalid value attribute",
            parameter: param
          });
          parsed = value;
        }
      } else if (valueType === "xsd:int" || valueType === "xsd:unsignedInt") {
        parsed = parseInt(value);
        if (isNaN(parsed)) {
          warnings.push({
            message: "Invalid value attribute",
            parameter: param
          });
          parsed = value;
        }
      } else if (valueType === "xsd:dateTime") {
        parsed = Date.parse(value);
        if (isNaN(parsed)) {
          warnings.push({
            message: "Invalid value attribute",
            parameter: param
          });
          parsed = value;
        }
      }

      return [param, parsed, valueType];
    });
}

function GetParameterNames(xml, methodRequest) {
  const el = xml.node("cwmp:GetParameterNames");
  el.node("ParameterPath").text(methodRequest.parameterPath);
  el.node("NextLevel").text(+methodRequest.nextLevel);
}

function GetParameterNamesResponse(xml) {
  return {
    name: "GetParameterNamesResponse",
    parameterList: parameterInfoList(
      xml.childNodes().find(n => n.name() === "ParameterList")
    )
  };
}

function GetParameterValues(xml, methodRequest) {
  const el = xml.node("cwmp:GetParameterValues").node("ParameterNames");
  el.attr({
    "soap-enc:arrayType": `xsd:string[${methodRequest.parameterNames.length}]`
  });

  for (const p of methodRequest.parameterNames) el.node("string").text(p);
}

function GetParameterValuesResponse(xml) {
  return {
    name: "GetParameterValuesResponse",
    parameterList: parameterValueList(
      xml.childNodes().find(n => n.name() === "ParameterList")
    )
  };
}

function SetParameterValues(xml, methodRequest) {
  const el = xml.node("cwmp:SetParameterValues");
  const paramList = el.node("ParameterList");
  paramList.attr({
    "soap-enc:arrayType": `cwmp:ParameterValueStruct[${
      methodRequest.parameterList.length
    }]`
  });

  for (const p of methodRequest.parameterList) {
    const pvs = paramList.node("ParameterValueStruct");
    pvs.node("Name").text(p[0]);
    let val = p[1];
    if (p[2] === "xsd:dateTime" && typeof val === "number") {
      val = new Date(val).toISOString();
      if (methodRequest.DATETIME_MILLISECONDS === false)
        val = val.replace(".000", "");
    }
    if (p[2] === "xsd:boolean" && typeof val === "boolean")
      if (methodRequest.BOOLEAN_LITERAL === false) val = +val;

    pvs
      .node("Value")
      .attr({ "xsi:type": p[2] })
      .text(val);
  }

  el.node("ParameterKey").text(methodRequest.parameterKey || "");
}

function SetParameterValuesResponse(xml) {
  return {
    name: "SetParameterValuesResponse",
    status: parseInt(
      xml
        .childNodes()
        .find(n => n.name() === "Status")
        .text()
    )
  };
}

function AddObject(xml, methodRequest) {
  const el = xml.node("cwmp:AddObject");
  el.node("ObjectName").text(methodRequest.objectName);
  el.node("ParameterKey").text(methodRequest.parameterKey || "");
}

function AddObjectResponse(xml) {
  let instanceNumber, status;
  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "InstanceNumber":
        instanceNumber = parseInt(c.text());
        break;
      case "Status":
        status = parseInt(c.text());
        break;
    }
  }

  return {
    name: "AddObjectResponse",
    instanceNumber: instanceNumber,
    status: status
  };
}

function DeleteObject(xml, methodRequest) {
  const el = xml.node("cwmp:DeleteObject");
  el.node("ObjectName").text(methodRequest.objectName);
  el.node("ParameterKey").text(methodRequest.parameterKey || "");
}

function DeleteObjectResponse(xml) {
  return {
    name: "DeleteObjectResponse",
    status: parseInt(
      xml
        .childNodes()
        .find(n => n.name() === "Status")
        .text()
    )
  };
}

function Reboot(xml, methodRequest) {
  const el = xml.node("cwmp:Reboot");
  el.node("CommandKey").text(methodRequest.commandKey || "");
}

function RebootResponse() {
  return {
    name: "RebootResponse"
  };
}

function FactoryReset(xml) {
  xml.node("cwmp:FactoryReset");
}

function FactoryResetResponse() {
  return {
    name: "FactoryResetResponse"
  };
}

function Download(xml, methodRequest) {
  const el = xml.node("cwmp:Download");
  el.node("CommandKey").text(methodRequest.commandKey || "");
  el.node("FileType").text(methodRequest.fileType);
  el.node("URL").text(methodRequest.url);
  el.node("Username").text(methodRequest.username || "");
  el.node("Password").text(methodRequest.password || "");
  el.node("FileSize").text(methodRequest.fileSize || "0");
  el.node("TargetFileName").text(methodRequest.targetFileName || "");
  el.node("DelaySeconds").text(methodRequest.delaySeconds || "0");
  el.node("SuccessURL").text(methodRequest.successUrl || "");
  el.node("FailureURL").text(methodRequest.failureUrl || "");
}

function DownloadResponse(xml) {
  let status, startTime, completeTime;
  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "Status":
        status = parseInt(c.text());
        break;
      case "StartTime":
        startTime = Date.parse(c.text());
        break;
      case "CompleteTime":
        completeTime = Date.parse(c.text());
        break;
    }
  }

  return {
    name: "DownloadResponse",
    status: status,
    startTime: startTime,
    completeTime: completeTime
  };
}

function Inform(xml) {
  let retryCount, evnt, parameterList;
  const deviceId = {
    Manufacturer: null,
    OUI: null,
    ProductClass: null,
    SerialNumber: null
  };

  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "ParameterList":
        parameterList = parameterValueList(c);
        break;
      case "DeviceId":
        for (const cc of c.childNodes()) {
          const n = cc.name();
          if (n in deviceId) deviceId[n] = cc.text();
        }
        break;
      case "Event":
        evnt = event(c);
        break;
      case "RetryCount":
        retryCount = parseInt(c.text());
        break;
    }
  }

  return {
    name: "Inform",
    parameterList: parameterList,
    deviceId: deviceId,
    event: evnt,
    retryCount: retryCount
  };
}

function InformResponse(xml) {
  xml
    .node("cwmp:InformResponse")
    .node("MaxEnvelopes")
    .text(1);
}

function GetRPCMethods() {
  return { name: "GetRPCMethods" };
}

function GetRPCMethodsResponse(xml, methodResponse) {
  const el = xml.node("cwmp:GetRPCMethodsResponse").node("MethodList");
  el.attr({
    "soap-enc:arrayType": `xsd:string[${methodResponse.methodList.length}]`
  });

  for (const m of methodResponse.methodList) el.node("string").text(m);
}

function TransferComplete(xml) {
  let commandKey, _faultStruct, startTime, completeTime;
  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "CommandKey":
        commandKey = c.text();
        break;
      case "FaultStruct":
        _faultStruct = faultStruct(c);
        break;
      case "StartTime":
        startTime = Date.parse(c.text());
        break;
      case "CompleteTime":
        completeTime = Date.parse(c.text());
        break;
    }
  }

  return {
    name: "TransferComplete",
    commandKey: commandKey,
    faultStruct: _faultStruct,
    startTime: startTime,
    completeTime: completeTime
  };
}

function TransferCompleteResponse(xml) {
  xml.node("cwmp:TransferCompleteResponse").text("");
}

function RequestDownload(xml) {
  return {
    name: "RequestDownload",
    fileType: xml
      .childNodes()
      .find(n => n.name() === "FileType")
      .text()
  };
}

function RequestDownloadResponse(xml) {
  xml.node("cwmp:RequestDownloadResponse").text("");
}

function faultStruct(xml) {
  let faultCode, faultString, setParameterValuesFault, pn, fc, fs;
  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "FaultCode":
        faultCode = c.text();
        break;
      case "FaultString":
        faultString = c.text();
        break;
      case "SetParameterValuesFault":
        setParameterValuesFault = setParameterValuesFault || [];
        for (const cc of c.childNodes()) {
          switch (cc.name()) {
            case "ParameterName":
              pn = cc.text();
              break;
            case "FaultCode":
              fc = cc.text();
              break;
            case "FaultString":
              fs = cc.text();
              break;
          }
        }
        setParameterValuesFault.push({
          parameterName: pn,
          faultCode: fc,
          faultString: fs
        });
    }
  }

  return { faultCode, faultString, setParameterValuesFault };
}

function fault(xml) {
  let faultCode, faultString, detail;
  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "faultcode":
        faultCode = c.text();
        break;
      case "faultstring":
        faultString = c.text();
        break;
      case "detail":
        detail = faultStruct(c.childNodes().find(n => n.name() === "Fault"));
        break;
    }
  }

  return { faultCode, faultString, detail };
}

function request(data, cwmpVersion, warn) {
  warnings = warn;

  const rpc = {
    id: null,
    cwmpVersion: cwmpVersion,
    sessionTimeout: null,
    cpeRequest: null,
    cpeFault: null
  };

  if (!data.length) return rpc;

  const xml = libxmljs.parseXml(data, LIBXMLJS_PARSE_OPTIONS);

  let headerElement, bodyElement;

  for (const c of xml.childNodes()) {
    switch (c.name()) {
      case "Header":
        headerElement = c;
        break;
      case "Body":
        bodyElement = c;
        break;
    }
  }

  if (headerElement) {
    for (const c of headerElement.childNodes()) {
      switch (c.name()) {
        case "ID":
          rpc.id = c.text();
          break;
        case "sessionTimeout":
          rpc.sessionTimeout = parseInt(c.text());
          break;
      }
    }
  }

  for (const methodElement of bodyElement.childNodes()) {
    const methodName = methodElement.name();
    if (methodName === "text") continue;

    if (!rpc.cwmpVersion && methodName !== "Fault") {
      switch (methodElement.namespace().href()) {
        case "urn:dslforum-org:cwmp-1-0":
          rpc.cwmpVersion = "1.0";
          break;
        case "urn:dslforum-org:cwmp-1-1":
          rpc.cwmpVersion = "1.1";
          break;
        case "urn:dslforum-org:cwmp-1-2":
          if (rpc.sessionTimeout) rpc.cwmpVersion = "1.3";
          else rpc.cwmpVersion = "1.2";

          break;
        case "urn:dslforum-org:cwmp-1-3":
          rpc.cwmpVersion = "1.4";
          break;
        default:
          throw new Error("Unrecognized CWMP version");
      }
    }

    switch (methodName) {
      case "Inform":
        rpc.cpeRequest = Inform(methodElement);
        break;
      case "GetRPCMethods":
        rpc.cpeRequest = GetRPCMethods(methodElement);
        break;
      case "TransferComplete":
        rpc.cpeRequest = TransferComplete(methodElement);
        break;
      case "RequestDownload":
        rpc.cpeRequest = RequestDownload(methodElement);
        break;
      case "GetParameterNamesResponse":
        rpc.cpeResponse = GetParameterNamesResponse(methodElement);
        break;
      case "GetParameterValuesResponse":
        rpc.cpeResponse = GetParameterValuesResponse(methodElement);
        break;
      case "SetParameterValuesResponse":
        rpc.cpeResponse = SetParameterValuesResponse(methodElement);
        break;
      case "AddObjectResponse":
        rpc.cpeResponse = AddObjectResponse(methodElement);
        break;
      case "DeleteObjectResponse":
        rpc.cpeResponse = DeleteObjectResponse(methodElement);
        break;
      case "RebootResponse":
        rpc.cpeResponse = RebootResponse(methodElement);
        break;
      case "FactoryResetResponse":
        rpc.cpeResponse = FactoryResetResponse(methodElement);
        break;
      case "DownloadResponse":
        rpc.cpeResponse = DownloadResponse(methodElement);
        break;
      case "Fault":
        rpc.cpeFault = fault(methodElement, rpc.cwmpVersion);
        break;
      default:
        throw new Error(`8000 Method not supported ${methodName}`);
    }
  }

  return rpc;
}

function createSoapEnv(cwmpVersion) {
  const xml = libxmljs.Document();
  const env = xml.node("soap-env:Envelope");

  for (const prefix of Object.keys(NAMESPACES[cwmpVersion]))
    env.defineNamespace(prefix, NAMESPACES[cwmpVersion][prefix]);

  return env;
}

function response(rpc) {
  const headers = {
    Server: SERVER_NAME,
    SOAPServer: SERVER_NAME
  };

  if (!rpc) return { code: 204, headers: headers, data: Buffer.allocUnsafe(0) };

  const env = createSoapEnv(rpc.cwmpVersion);
  const header = env.node("soap-env:Header");
  header
    .node("cwmp:ID")
    .attr({
      "soap-env:mustUnderstand": 1
    })
    .text(rpc.id);

  const body = env.node("soap-env:Body");

  if (rpc.acsResponse) {
    switch (rpc.acsResponse.name) {
      case "InformResponse":
        InformResponse(body, rpc.acsResponse);
        break;
      case "GetRPCMethodsResponse":
        GetRPCMethodsResponse(body, rpc.acsResponse);
        break;
      case "TransferCompleteResponse":
        TransferCompleteResponse(body, rpc.acsResponse);
        break;
      case "RequestDownloadResponse":
        RequestDownloadResponse(body, rpc.acsResponse);
        break;
      default:
        throw new Error(`Unknown method response type ${rpc.acsResponse.name}`);
    }
  } else if (rpc.acsRequest) {
    switch (rpc.acsRequest.name) {
      case "GetParameterNames":
        GetParameterNames(body, rpc.acsRequest);
        break;
      case "GetParameterValues":
        GetParameterValues(body, rpc.acsRequest);
        break;
      case "SetParameterValues":
        SetParameterValues(body, rpc.acsRequest);
        break;
      case "AddObject":
        AddObject(body, rpc.acsRequest);
        break;
      case "DeleteObject":
        DeleteObject(body, rpc.acsRequest);
        break;
      case "Reboot":
        Reboot(body, rpc.acsRequest);
        break;
      case "FactoryReset":
        FactoryReset(body, rpc.acsRequest);
        break;
      case "Download":
        Download(body, rpc.acsRequest);
        break;
      default:
        throw new Error(`Unknown method request ${rpc.acsRequest.name}`);
    }
  }

  headers["Content-Type"] = 'text/xml; charset="utf-8"';
  return {
    code: 200,
    headers: headers,
    data: env.doc().toString(LIBXMLJS_SAVE_OPTIONS)
  };
}

exports.request = request;
exports.response = response;
