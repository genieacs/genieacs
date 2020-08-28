/**
 * Copyright 2013-2019  GenieACS Inc.
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

import {
  parseXml,
  Element,
  parseAttrs,
  encodeEntities,
  decodeEntities,
} from "./xml-parser";
import memoize from "./common/memoize";
import { version as VERSION } from "../package.json";
import {
  InformRequest,
  FaultStruct,
  SpvFault,
  CpeFault,
  SoapMessage,
  TransferCompleteRequest,
  AcsRequest,
  GetParameterNamesResponse,
  GetParameterValuesResponse,
  GetParameterAttributesResponse,
  SetParameterValuesResponse,
  SetParameterAttributesResponse,
  AddObjectResponse,
  DeleteObject,
  DeleteObjectResponse,
  RebootResponse,
  FactoryResetResponse,
  DownloadResponse,
  GetRPCMethodsRequest,
  RequestDownloadRequest,
  AcsResponse,
} from "./types";
import Path from "./common/path";

const SERVER_NAME = `GenieACS/${VERSION}`;

const NAMESPACES = {
  "1.0": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-0",
  },
  "1.1": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-1",
  },
  "1.2": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-2",
  },
  "1.3": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-2",
  },
  "1.4": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-3",
  },
};

let warnings: Record<string, unknown>[];

const memoizedParseAttrs = memoize(parseAttrs);

function parseBool(v: string): boolean {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

function event(xml: Element): string[] {
  return xml.children
    .filter((n) => n.localName === "EventStruct")
    .map((c) => c.children.find((n) => n.localName === "EventCode").text);
}

function parameterInfoList(xml: Element): [Path, boolean, boolean][] {
  return xml.children
    .filter((e) => e.localName === "ParameterInfoStruct")
    .map<[Path, boolean, boolean]>((e) => {
      let param: string, value: string;
      for (const c of e.children) {
        switch (c.localName) {
          case "Name":
            param = c.text;
            break;
          case "Writable":
            value = c.text;
            break;
        }
      }

      let parsed: boolean = parseBool(value);

      if (parsed == null) {
        warnings.push({
          message: "Invalid writable attribute",
          parameter: param,
        });
        parsed = false;
      }

      if (param && !param.endsWith("."))
        return [Path.parse(param), false, parsed];
      else return [Path.parse(param.slice(0, -1)), true, parsed];
    });
}

const getValueType = memoize((str: string) => {
  const attrs = parseAttrs(str);
  for (const attr of attrs) if (attr.localName === "type") return attr.value;

  return null;
});

function parameterValueList(
  xml: Element
): [Path, string | number | boolean, string][] {
  return xml.children
    .filter((e) => e.localName === "ParameterValueStruct")
    .map<[Path, string | number | boolean, string]>((e) => {
      let valueElement: Element, param: string;
      for (const c of e.children) {
        switch (c.localName) {
          case "Name":
            param = c.text;
            break;
          case "Value":
            valueElement = c;
            break;
        }
      }

      let valueType = getValueType(valueElement.attrs);
      if (!valueType) {
        warnings.push({
          message: "Invalid value type attribute",
          parameter: param,
        });
        valueType = "xsd:string";
      }

      const value = decodeEntities(valueElement.text);
      let parsed: string | number | boolean = value;
      if (valueType === "xsd:boolean") {
        parsed = parseBool(value);
        if (parsed == null) {
          warnings.push({
            message: "Invalid value attribute",
            parameter: param,
          });
          parsed = value;
        }
      } else if (valueType === "xsd:int" || valueType === "xsd:unsignedInt") {
        parsed = parseInt(value);
        if (isNaN(parsed)) {
          warnings.push({
            message: "Invalid value attribute",
            parameter: param,
          });
          parsed = value;
        }
      } else if (valueType === "xsd:dateTime") {
        parsed = Date.parse(value);
        if (isNaN(parsed)) {
          warnings.push({
            message: "Invalid value attribute",
            parameter: param,
          });
          parsed = value;
        }
      }

      return [Path.parse(param), parsed, valueType];
    });
}

function parameterAttributeList(xml: Element): [Path, number, string[]][] {
  return xml.children
    .filter((e) => e.localName === "ParameterAttributeStruct")
    .map<[Path, number, string[]]>((e) => {
      let notificationElement: Element,
        accessListElement: Element,
        param: string;
      for (const c of e.children) {
        switch (c.localName) {
          case "Name":
            param = c.text;
            break;
          case "Notification":
            notificationElement = c;
            break;
          case "AccessList":
            accessListElement = c;
            break;
        }
      }

      let notification = parseInt(notificationElement.text);
      if (isNaN(notification)) {
        warnings.push({
          message: "Invalid notification attribute",
          parameter: param,
        });
        notification = 0;
      }

      const accessList = accessListElement.children
        .filter((c) => c.localName === "string")
        .map((c) => decodeEntities(c.text));

      return [Path.parse(param), notification, accessList];
    });
}

function GetParameterNames(methodRequest): string {
  return `<cwmp:GetParameterNames><ParameterPath>${
    methodRequest.parameterPath
  }</ParameterPath><NextLevel>${+methodRequest.nextLevel}</NextLevel></cwmp:GetParameterNames>`;
}

function GetParameterNamesResponse(xml): GetParameterNamesResponse {
  return {
    name: "GetParameterNamesResponse",
    parameterList: parameterInfoList(
      xml.children.find((n) => n.localName === "ParameterList")
    ),
  };
}

function GetParameterValues(methodRequest): string {
  return `<cwmp:GetParameterValues><ParameterNames soap-enc:arrayType="xsd:string[${
    methodRequest.parameterNames.length
  }]">${methodRequest.parameterNames
    .map((p) => `<string>${p}</string>`)
    .join("")}</ParameterNames></cwmp:GetParameterValues>`;
}

function GetParameterValuesResponse(xml: Element): GetParameterValuesResponse {
  return {
    name: "GetParameterValuesResponse",
    parameterList: parameterValueList(
      xml.children.find((n) => n.localName === "ParameterList")
    ),
  };
}

function GetParameterAttributes(methodRequest): string {
  return `<cwmp:GetParameterAttributes><ParameterNames soap-enc:arrayType="xsd:string[${
    methodRequest.parameterNames.length
  }]">${methodRequest.parameterNames
    .map((p) => `<string>${p}</string>`)
    .join("")}</ParameterNames></cwmp:GetParameterAttributes>`;
}

function GetParameterAttributesResponse(
  xml: Element
): GetParameterAttributesResponse {
  return {
    name: "GetParameterAttributesResponse",
    parameterList: parameterAttributeList(
      xml.children.find((n) => n.localName === "ParameterList")
    ),
  };
}

function SetParameterValues(methodRequest): string {
  const params = methodRequest.parameterList.map((p) => {
    let val = p[1];
    if (p[2] === "xsd:dateTime" && typeof val === "number") {
      val = new Date(val).toISOString();
      if (methodRequest.DATETIME_MILLISECONDS === false)
        val = val.replace(".000", "");
    }
    if (p[2] === "xsd:boolean" && typeof val === "boolean")
      if (methodRequest.BOOLEAN_LITERAL === false) val = +val;
    return `<ParameterValueStruct><Name>${p[0]}</Name><Value xsi:type="${
      p[2]
    }">${encodeEntities("" + val)}</Value></ParameterValueStruct>`;
  });

  return `<cwmp:SetParameterValues><ParameterList soap-enc:arrayType="cwmp:ParameterValueStruct[${
    methodRequest.parameterList.length
  }]">${params.join("")}</ParameterList><ParameterKey>${
    methodRequest.parameterKey || ""
  }</ParameterKey></cwmp:SetParameterValues>`;
}

function SetParameterValuesResponse(xml: Element): SetParameterValuesResponse {
  let status: number;

  for (const c of xml.children) {
    switch (c.localName) {
      case "Status":
        status = parseInt(c.text);
        break;
    }
  }

  if (!(status >= 0)) {
    warnings.push({ message: "Invalid SetParameterValuesResponse status" });
    status = 0;
  }

  return {
    name: "SetParameterValuesResponse",
    status: status,
  };
}

function SetParameterAttributes(methodRequest): string {
  const params = methodRequest.parameterList.map((p) => {
    return `<SetParameterAttributesStruct><Name>${
      p[0]
    }</Name><NotificationChange>${
      p[1] == null ? "false" : "true"
    }</NotificationChange><Notification>${
      p[1] == null ? "" : p[1]
    }</Notification><AccessListChange>${
      p[2] == null ? "false" : "true"
    }</AccessListChange><AccessList soap-enc:arrayType="xsd:string[${
      (p[2] || []).length
    }]">${
      p[2] == null
        ? ""
        : p[2].map((s) => `<string>${encodeEntities(s)}</string>`).join("")
    }</AccessList></SetParameterAttributesStruct>`;
  });

  return `<cwmp:SetParameterAttributes><ParameterList soap-enc:arrayType="cwmp:SetParameterAttributesStruct[${
    methodRequest.parameterList.length
  }]">${params.join("")}</ParameterList></cwmp:SetParameterAttributes>`;
}

function SetParameterAttributesResponse(): SetParameterAttributesResponse {
  return {
    name: "SetParameterAttributesResponse",
  };
}

function AddObject(methodRequest): string {
  return `<cwmp:AddObject><ObjectName>${
    methodRequest.objectName
  }</ObjectName><ParameterKey>${
    methodRequest.parameterKey || ""
  }</ParameterKey></cwmp:AddObject>`;
}

function AddObjectResponse(xml: Element): AddObjectResponse {
  let instanceNumber: string, status: number;
  for (const c of xml.children) {
    switch (c.localName) {
      case "InstanceNumber":
        instanceNumber = c.text;
        break;
      case "Status":
        status = parseInt(c.text);
        break;
    }
  }

  if (!(status >= 0)) {
    warnings.push({ message: "Invalid AddObjectResponse status" });
    status = 0;
  }

  return {
    name: "AddObjectResponse",
    instanceNumber: instanceNumber,
    status: status,
  };
}

function DeleteObject(methodRequest): string {
  return `<cwmp:DeleteObject><ObjectName>${
    methodRequest.objectName
  }</ObjectName><ParameterKey>${
    methodRequest.parameterKey || ""
  }</ParameterKey></cwmp:DeleteObject>`;
}

function DeleteObjectResponse(xml: Element): DeleteObjectResponse {
  let status: number;

  for (const c of xml.children) {
    switch (c.localName) {
      case "Status":
        status = parseInt(c.text);
        break;
    }
  }

  if (!(status >= 0)) {
    warnings.push({ message: "Invalid DeleteObjectResponse status" });
    status = 0;
  }

  return {
    name: "DeleteObjectResponse",
    status: status,
  };
}

function Reboot(methodRequest): string {
  return `<cwmp:Reboot><CommandKey>${
    methodRequest.commandKey || ""
  }</CommandKey></cwmp:Reboot>`;
}

function RebootResponse(): RebootResponse {
  return {
    name: "RebootResponse",
  };
}

function FactoryReset(): string {
  return "<cwmp:FactoryReset></cwmp:FactoryReset>";
}

function FactoryResetResponse(): FactoryResetResponse {
  return {
    name: "FactoryResetResponse",
  };
}

function Download(methodRequest): string {
  return `<cwmp:Download><CommandKey>${
    methodRequest.commandKey || ""
  }</CommandKey><FileType>${methodRequest.fileType}</FileType><URL>${
    methodRequest.url
  }</URL><Username>${encodeEntities(
    methodRequest.username || ""
  )}</Username><Password>${encodeEntities(
    methodRequest.password || ""
  )}</Password><FileSize>${
    methodRequest.fileSize || "0"
  }</FileSize><TargetFileName>${encodeEntities(
    methodRequest.targetFileName || ""
  )}</TargetFileName><DelaySeconds>${
    methodRequest.delaySeconds || "0"
  }</DelaySeconds><SuccessURL>${encodeEntities(
    methodRequest.successUrl || ""
  )}</SuccessURL><FailureURL>${encodeEntities(
    methodRequest.failureUrl || ""
  )}</FailureURL></cwmp:Download>`;
}

function DownloadResponse(xml: Element): DownloadResponse {
  let status: number, startTime: number, completeTime: number;
  for (const c of xml.children) {
    switch (c.localName) {
      case "Status":
        status = parseInt(c.text);
        break;
      case "StartTime":
        startTime = Date.parse(c.text);
        break;
      case "CompleteTime":
        completeTime = Date.parse(c.text);
        break;
    }
  }

  if (!(status >= 0)) {
    warnings.push({ message: "Invalid DownloadResponse status" });
    status = 0;
  }

  return {
    name: "DownloadResponse",
    status: status,
    startTime: startTime,
    completeTime: completeTime,
  };
}

function Inform(xml: Element): InformRequest {
  let retryCount: number, evnt: string[];
  let parameterList: [Path, string | number | boolean, string][];
  const deviceId = {
    Manufacturer: null,
    OUI: null,
    ProductClass: null,
    SerialNumber: null,
  };

  for (const c of xml.children) {
    switch (c.localName) {
      case "ParameterList":
        parameterList = parameterValueList(c);
        break;
      case "DeviceId":
        for (const cc of c.children) {
          const n = cc.localName;
          if (n in deviceId) deviceId[n] = decodeEntities(cc.text);
        }
        break;
      case "Event":
        evnt = event(c);
        break;
      case "RetryCount":
        retryCount = parseInt(c.text);
        break;
    }
  }

  return {
    name: "Inform",
    parameterList: parameterList,
    deviceId: deviceId,
    event: evnt,
    retryCount: retryCount,
  };
}

function InformResponse(): string {
  return "<cwmp:InformResponse><MaxEnvelopes>1</MaxEnvelopes></cwmp:InformResponse>";
}

function GetRPCMethods(): GetRPCMethodsRequest {
  return { name: "GetRPCMethods" };
}

function GetRPCMethodsResponse(methodResponse): string {
  return `<cwmp:GetRPCMethodsResponse><MethodList soap-enc:arrayType="xsd:string[${
    methodResponse.methodList.length
  }]">${methodResponse.methodList
    .map((m) => `<string>${m}</string>`)
    .join("")}</MethodList></cwmp:GetRPCMethodsResponse>`;
}

function TransferComplete(xml: Element): TransferCompleteRequest {
  let commandKey, _faultStruct, startTime, completeTime;
  for (const c of xml.children) {
    switch (c.localName) {
      case "CommandKey":
        commandKey = c.text;
        break;
      case "FaultStruct":
        _faultStruct = faultStruct(c);
        break;
      case "StartTime":
        startTime = Date.parse(c.text);
        break;
      case "CompleteTime":
        completeTime = Date.parse(c.text);
        break;
    }
  }

  return {
    name: "TransferComplete",
    commandKey: commandKey,
    faultStruct: _faultStruct,
    startTime: startTime,
    completeTime: completeTime,
  };
}

function TransferCompleteResponse(): string {
  return "<cwmp:TransferCompleteResponse></cwmp:TransferCompleteResponse>";
}

function RequestDownload(xml: Element): RequestDownloadRequest {
  return {
    name: "RequestDownload",
    fileType: xml.children.find((n) => n.localName === "FileType").text,
  };
}

function RequestDownloadResponse(): string {
  return "<cwmp:RequestDownloadResponse></cwmp:RequestDownloadResponse>";
}

function faultStruct(xml: Element): FaultStruct {
  let faultCode, faultString, setParameterValuesFault: SpvFault[], pn, fc, fs;
  for (const c of xml.children) {
    switch (c.localName) {
      case "FaultCode":
        faultCode = c.text;
        break;
      case "FaultString":
        faultString = decodeEntities(c.text);
        break;
      case "SetParameterValuesFault":
        setParameterValuesFault = setParameterValuesFault || [];
        for (const cc of c.children) {
          switch (cc.localName) {
            case "ParameterName":
              pn = cc.text;
              break;
            case "FaultCode":
              fc = cc.text;
              break;
            case "FaultString":
              fs = decodeEntities(cc.text);
              break;
          }
        }
        setParameterValuesFault.push({
          parameterName: pn,
          faultCode: fc,
          faultString: fs,
        });
    }
  }

  return { faultCode, faultString, setParameterValuesFault };
}

function fault(xml: Element): CpeFault {
  let faultCode, faultString, detail;
  for (const c of xml.children) {
    switch (c.localName) {
      case "faultcode":
        faultCode = c.text;
        break;
      case "faultstring":
        faultString = decodeEntities(c.text);
        break;
      case "detail":
        detail = faultStruct(c.children.find((n) => n.localName === "Fault"));
        break;
    }
  }

  return { faultCode, faultString, detail };
}

export function request(
  body: string,
  cwmpVersion: string,
  warn: Record<string, unknown>[]
): SoapMessage {
  warnings = warn;

  const rpc = {
    id: null,
    cwmpVersion: cwmpVersion,
    sessionTimeout: null,
    cpeRequest: null,
    cpeFault: null,
    cpeResponse: null,
  };

  if (!body.length) return rpc;

  const xml = parseXml(body);

  if (!xml.children.length) return rpc;

  const envelope = xml.children[0];

  let headerElement: Element, bodyElement: Element;

  for (const c of envelope.children) {
    switch (c.localName) {
      case "Header":
        headerElement = c;
        break;
      case "Body":
        bodyElement = c;
        break;
    }
  }

  if (headerElement) {
    for (const c of headerElement.children) {
      switch (c.localName) {
        case "ID":
          rpc.id = decodeEntities(c.text);
          break;
        case "sessionTimeout":
          rpc.sessionTimeout = parseInt(c.text);
          break;
      }
    }
  }

  const methodElement = bodyElement.children[0];

  if (!rpc.cwmpVersion && methodElement.localName !== "Fault") {
    let namespace, namespaceHref;
    for (const e of [methodElement, bodyElement, envelope]) {
      namespace = namespace || e.namespace;
      if (e.attrs) {
        const attrs = memoizedParseAttrs(e.attrs);
        const attr = namespace
          ? attrs.find(
              (s) => s.namespace === "xmlns" && s.localName === namespace
            )
          : attrs.find((s) => s.name === "xmlns");

        if (attr) namespaceHref = attr.value;
      }
    }

    switch (namespaceHref) {
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

  switch (methodElement.localName) {
    case "Inform":
      rpc.cpeRequest = Inform(methodElement);
      break;
    case "GetRPCMethods":
      rpc.cpeRequest = GetRPCMethods();
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
    case "GetParameterAttributesResponse":
      rpc.cpeResponse = GetParameterAttributesResponse(methodElement);
      break;
    case "SetParameterValuesResponse":
      rpc.cpeResponse = SetParameterValuesResponse(methodElement);
      break;
    case "SetParameterAttributesResponse":
      rpc.cpeResponse = SetParameterAttributesResponse();
      break;
    case "AddObjectResponse":
      rpc.cpeResponse = AddObjectResponse(methodElement);
      break;
    case "DeleteObjectResponse":
      rpc.cpeResponse = DeleteObjectResponse(methodElement);
      break;
    case "RebootResponse":
      rpc.cpeResponse = RebootResponse();
      break;
    case "FactoryResetResponse":
      rpc.cpeResponse = FactoryResetResponse();
      break;
    case "DownloadResponse":
      rpc.cpeResponse = DownloadResponse(methodElement);
      break;
    case "Fault":
      rpc.cpeFault = fault(methodElement);
      break;
    default:
      throw new Error(`8000 Method not supported ${methodElement.localName}`);
  }

  return rpc;
}

const namespacesAttrs = {
  "1.0": Object.entries(NAMESPACES["1.0"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.1": Object.entries(NAMESPACES["1.1"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.2": Object.entries(NAMESPACES["1.2"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.3": Object.entries(NAMESPACES["1.3"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.4": Object.entries(NAMESPACES["1.4"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
};

export function response(rpc: {
  id: string;
  acsRequest?: AcsRequest;
  acsResponse?: AcsResponse;
  cwmpVersion?: string;
}): { code: number; headers: Record<string, string>; data: string } {
  const headers = {
    Server: SERVER_NAME,
    SOAPServer: SERVER_NAME,
  };

  if (!rpc) return { code: 204, headers: headers, data: "" };

  let body;
  if (rpc.acsResponse) {
    switch (rpc.acsResponse.name) {
      case "InformResponse":
        body = InformResponse();
        break;
      case "GetRPCMethodsResponse":
        body = GetRPCMethodsResponse(rpc.acsResponse);
        break;
      case "TransferCompleteResponse":
        body = TransferCompleteResponse();
        break;
      case "RequestDownloadResponse":
        body = RequestDownloadResponse();
        break;
      default:
        throw new Error(
          `Unknown method response type ${
            (rpc.acsResponse as AcsResponse).name
          }`
        );
    }
  } else if (rpc.acsRequest) {
    switch (rpc.acsRequest.name) {
      case "GetParameterNames":
        body = GetParameterNames(rpc.acsRequest);
        break;
      case "GetParameterValues":
        body = GetParameterValues(rpc.acsRequest);
        break;
      case "GetParameterAttributes":
        body = GetParameterAttributes(rpc.acsRequest);
        break;
      case "SetParameterValues":
        body = SetParameterValues(rpc.acsRequest);
        break;
      case "SetParameterAttributes":
        body = SetParameterAttributes(rpc.acsRequest);
        break;
      case "AddObject":
        body = AddObject(rpc.acsRequest);
        break;
      case "DeleteObject":
        body = DeleteObject(rpc.acsRequest);
        break;
      case "Reboot":
        body = Reboot(rpc.acsRequest);
        break;
      case "FactoryReset":
        body = FactoryReset();
        break;
      case "Download":
        body = Download(rpc.acsRequest);
        break;
      default:
        throw new Error(
          `Unknown method request ${(rpc.acsRequest as AcsRequest).name}`
        );
    }
  }

  headers["Content-Type"] = 'text/xml; charset="utf-8"';
  return {
    code: 200,
    headers: headers,
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<soap-env:Envelope ${
      namespacesAttrs[rpc.cwmpVersion]
    }><soap-env:Header><cwmp:ID soap-env:mustUnderstand="1">${
      rpc.id
    }</cwmp:ID></soap-env:Header><soap-env:Body>${body}</soap-env:Body></soap-env:Envelope>`,
  };
}
