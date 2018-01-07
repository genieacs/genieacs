/**
 * Copyright 2013-2017  Zaid Abdulla
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
    "xsd": "http://www.w3.org/2001/XMLSchema",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "cwmp": "urn:dslforum-org:cwmp-1-0"
  },
  "1.1": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    "xsd": "http://www.w3.org/2001/XMLSchema",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "cwmp": "urn:dslforum-org:cwmp-1-1"
  },
  "1.2": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    "xsd": "http://www.w3.org/2001/XMLSchema",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "cwmp": "urn:dslforum-org:cwmp-1-2"
  },
  "1.3": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    "xsd": "http://www.w3.org/2001/XMLSchema",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "cwmp": "urn:dslforum-org:cwmp-1-2"
  },
  "1.4": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    "xsd": "http://www.w3.org/2001/XMLSchema",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "cwmp": "urn:dslforum-org:cwmp-1-3"
  }
};

const LIBXMLJS_PARSE_OPTIONS = {
  "nocdata": true,
  "recover": config.get("XML_RECOVER"),
  "ignore_enc": config.get("XML_IGNORE_ENC")
};

const LIBXMLJS_SAVE_OPTIONS = {
  "format": config.get("XML_FORMAT"),
  "declaration": !config.get("XML_NO_DECL"),
  "selfCloseEmpty": !config.get("XML_NO_EMPTY")
};

const XML_IGNORE_NAMESPACE = config.get("XML_IGNORE_NAMESPACE");

if (XML_IGNORE_NAMESPACE) {
  libxmljs.Element.prototype.__find = libxmljs.Element.prototype.find;
  libxmljs.Element.prototype.find = function(xpath, namespaces) {
    const p = xpath.replace(/([^\/:]+:)?([^\/]+)(\/|$)/g, "$2$3").replace(/([a-zA-Z0-9_-]+)([^\/]*)(\/|$)/g, "*[local-name()=\"$1\"]$2$3");
    return libxmljs.Element.prototype.__find.call(this, p, namespaces);
  };
}

let warnings;


function parseBool(v) {
  v = "" + v;
  if (v === "true" || v === "TRUE" || v === "True" || v === "1")
    return true;
  else if (v === "false" || v === "FALSE" || v === "False" || v === "0")
    return false;
  else
    return null;
}


function event(xml) {
  return xml.find("EventStruct/EventCode").map(e => e.text().trim());
}


function parameterInfoList(xml) {
  return xml.find("ParameterInfoStruct").map(function(e) {
    let param = e.get("Name").text();
    let value = e.get("Writable").text();
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
  return xml.find("ParameterValueStruct").map(function(e) {
    const valueElement = e.get("Value");
    const valueType = valueElement.attr("type").value();
    let param = e.get("Name").text();
    let value = valueElement.text();
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
    }
    else if (valueType === "xsd:int" || valueType === "xsd:unsignedInt") {
      parsed = parseInt(value);
      if (isNaN(parsed)) {
        warnings.push({
          message: "Invalid value attribute",
          parameter: param
        });
        parsed = value;
      }
    }
    else if (valueType === "xsd:dateTime") {
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
    parameterList: parameterInfoList(xml.get("ParameterList"))
  };
}


function GetParameterValues(xml, methodRequest) {
  const el = xml.node("cwmp:GetParameterValues").node("ParameterNames");
  el.attr({
    "soap-enc:arrayType": `xsd:string[${methodRequest.parameterNames.length}]`
  });

  for (const p of methodRequest.parameterNames)
    el.node("string").text(p);
}


function GetParameterValuesResponse(xml) {
  return {
    name: "GetParameterValuesResponse",
    parameterList: parameterValueList(xml.get("ParameterList"))
  };
}


function SetParameterValues(xml, methodRequest) {
  const el = xml.node("cwmp:SetParameterValues");
  const paramList = el.node("ParameterList");
  paramList.attr({
    "soap-enc:arrayType": `cwmp:ParameterValueStruct[${methodRequest.parameterList.length}]`
  });

  for (const p of methodRequest.parameterList) {
    const pvs = paramList.node("ParameterValueStruct");
    pvs.node("Name").text(p[0]);
    let val = p[1];
    if (p[2] === 'xsd:dateTime' && typeof val === 'number') {
      val = (new Date(val)).toISOString();
      if (methodRequest.DATETIME_MILLISECONDS === false)
        val = val.replace('.000', '');
    }
    if (p[2] === 'xsd:boolean' && typeof val === 'boolean') {
      if (methodRequest.BOOLEAN_LITERAL === false)
        val = +val;
    }
    pvs.node("Value").attr({"xsi:type": p[2]}).text(val);
  }

  el.node("ParameterKey").text(methodRequest.parameterKey || "");
}


function SetParameterValuesResponse(xml) {
  return {
    name: "SetParameterValuesResponse",
    status: parseInt(xml.get("Status").text())
  };
}


function AddObject(xml, methodRequest) {
  const el = xml.node("cwmp:AddObject");
  el.node("ObjectName").text(methodRequest.objectName);
  el.node("ParameterKey").text(methodRequest.parameterKey || "");
}


function AddObjectResponse(xml) {
  return {
    name: "AddObjectResponse",
    instanceNumber: parseInt(xml.get("InstanceNumber").text()),
    status: parseInt(xml.get("Status").text())
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
    status: parseInt(xml.get("Status").text())
  };
}


function Reboot(xml, methodRequest) {
  const el = xml.node("cwmp:Reboot");
  el.node("CommandKey").text(methodRequest.commandKey || "");
}


function RebootResponse(xml) {
  return {
    name: "RebootResponse"
  };
}


function FactoryReset(xml, methodRequest) {
  xml.node("cwmp:FactoryReset");
}


function FactoryResetResponse(xml, methodRequest) {
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
  const res = {
    name: "DownloadResponse",
    status: parseInt(xml.get("Status").text())
  };

  if (res.status === 0) {
    res.startTime = Date.parse(xml.get("StartTime").text());
    res.completeTime = Date.parse(xml.get("CompleteTime").text());
  }

  return res;
}


function Inform(xml) {
  return {
    name: "Inform",
    parameterList: parameterValueList(xml.get("ParameterList")),
    deviceId: {
      "Manufacturer": xml.get("DeviceId/Manufacturer").text(),
      "OUI": xml.get("DeviceId/OUI").text(),
      "ProductClass": xml.get("DeviceId/ProductClass").text(),
      "SerialNumber": xml.get("DeviceId/SerialNumber").text()
    },
    event: event(xml.get("Event")),
    retryCount: parseInt(xml.get("RetryCount").text())
  };
}


function InformResponse(xml, methodResponse) {
  xml.node("cwmp:InformResponse").node("MaxEnvelopes").text(1);
}


function GetRPCMethods(xml) {
  return {name: "GetRPCMethods"};
}


function GetRPCMethodsResponse(xml, methodResponse) {
  const el = xml.node("cwmp:GetRPCMethodsResponse").node("MethodList");
  el.attr({
    "soap-enc:arrayType": `xsd:string[${methodResponse.methodList.length}]`
  });

  for (const m of methodResponse.methodList)
    el.node("string").text(m);
}


function TransferComplete(xml) {
  return {
    name: "TransferComplete",
    commandKey: xml.get("CommandKey").text(),
    faultStruct: faultStruct(xml.get("FaultStruct")),
    startTime: Date.parse(xml.get("StartTime").text()),
    completeTime: Date.parse(xml.get("CompleteTime").text())
  };
}


function TransferCompleteResponse(xml, methodResponse) {
  xml.node("cwmp:TransferCompleteResponse").text("");
}


function RequestDownload(xml) {
  return {
    name: "RequestDownload",
    fileType: xml.get("FileType").text()
  };
}


function RequestDownloadResponse(xml, methodResponse) {
  xml.node("cwmp:RequestDownloadResponse").text("");
}


function faultStruct(xml) {
  const f = {
    faultCode: xml.get("FaultCode").text(),
    faultString: xml.get("FaultString").text()
  };

  for (const e of xml.find("SetParameterValuesFault")) {
    if (!f.setParameterValuesFault)
      f.setParameterValuesFault = [];

    f.setParameterValuesFault.push({
      parameterName: e.get("ParameterName").text(),
      faultCode: e.get("FaultCode").text(),
      faultString: e.get("FaultString").text()
    });
  }

  return f;
}


function fault(xml, cwmpVersion) {
  return {
    faultCode: xml.get("faultcode").text(),
    faultString: xml.get("faultstring").text(),
    detail: faultStruct(xml.get("detail/cwmp:Fault", NAMESPACES[cwmpVersion]))
  };
}


function request(data, cwmpVersion, warn) {
  warnings = warn;

  const rpc = {
    cwmpVersion: cwmpVersion
  };

  if (!data.length)
    return rpc;

  const xml = libxmljs.parseXml(data, LIBXMLJS_PARSE_OPTIONS);

  let methodElement;

  if (rpc.cwmpVersion) {
    methodElement = xml.get("/soap-env:Envelope/soap-env:Body/cwmp:*", NAMESPACES[rpc.cwmpVersion]);
  }
  else {
    // cwmpVersion not passed, thus it's an inform request
    methodElement = xml.get("/soap-env:Envelope/soap-env:Body/*", NAMESPACES["1.0"]);
    switch (methodElement.namespace().href()) {
      case "urn:dslforum-org:cwmp-1-0":
        rpc.cwmpVersion = "1.0";
        break;
      case "urn:dslforum-org:cwmp-1-1":
        rpc.cwmpVersion = "1.1";
        break;
      case "urn:dslforum-org:cwmp-1-2":
        const timeoutElement = xml.get("/soap-env:Envelope/soap-env:Header/cwmp:sessionTimeout", NAMESPACES["1.2"]);
        if (timeoutElement) {
          rpc.sessionTimeout = parseInt(timeoutElement.text());
          rpc.cwmpVersion = "1.3";
        }
        else {
          rpc.cwmpVersion = "1.2";
        }
        break;
      case "urn:dslforum-org:cwmp-1-3":
        rpc.cwmpVersion = "1.4";
        break;
      default:
        throw new Error("Unrecognized CWMP version");
    }

    if (!rpc.sessionTimeout) {
      const timeoutElement = xml.get("/soap-env:Envelope/soap-env:Header/cwmp:sessionTimeout", NAMESPACES[rpc.cwmpVersion]);
      if (timeoutElement)
        rpc.sessionTimeout = parseInt(timeoutElement.text());
    }
  }

  let idElement = xml.get("/soap-env:Envelope/soap-env:Header/cwmp:ID", NAMESPACES[rpc.cwmpVersion]);
  if (idElement)
    rpc.id = idElement.text();

  if (methodElement && !(XML_IGNORE_NAMESPACE && methodElement.name() === "Fault")) {
    switch (methodElement.name()) {
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
      default:
        throw new Error(`8000 Method not supported ${methodElement.name()}`);
    }
  }
  else {
    const faultElement = xml.get("/soap-env:Envelope/soap-env:Body/soap-env:Fault", NAMESPACES[rpc.cwmpVersion]);
    rpc.cpeFault = fault(faultElement, rpc.cwmpVersion);
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
    "Server": SERVER_NAME,
    "SOAPServer": SERVER_NAME
  };

  if (!rpc)
    return {code: 204, headers: headers, data: new Buffer(0)};

  const env = createSoapEnv(rpc.cwmpVersion);
  const header = env.node("soap-env:Header");
  header.node("cwmp:ID").attr({
    "soap-env:mustUnderstand": 1
  }).text(rpc.id);

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
  }
  else if (rpc.acsRequest) {
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

  headers["Content-Type"] = "text/xml; charset=\"utf-8\"";
  return {
    code: 200,
    headers: headers,
    data: new Buffer(env.doc().toString(LIBXMLJS_SAVE_OPTIONS))
  };
}


exports.request = request;
exports.response = response;
