import {
  parseXml,
  Element,
  parseAttrs,
  encodeEntities,
  decodeEntities,
} from "./xml-parser.ts";
import memoize from "./common/memoize.ts";
import { version as VERSION } from "../package.json";
import {
  InformRequest,
  FaultStruct,
  SpvFault,
  CpeFault,
  SoapMessage,
  TransferCompleteRequest,
  AcsRequest,
  type GetParameterNames,
  type GetParameterNamesResponse,
  type GetParameterValues,
  type GetParameterValuesResponse,
  type GetParameterAttributes,
  type GetParameterAttributesResponse,
  type SetParameterValues,
  type SetParameterValuesResponse,
  type SetParameterAttributes,
  type SetParameterAttributesResponse,
  type AddObject,
  type AddObjectResponse,
  type DeleteObject,
  type DeleteObjectResponse,
  type Reboot,
  type RebootResponse,
  type FactoryReset,
  type FactoryResetResponse,
  type Download,
  type DownloadResponse,
  type Upload,
  type UploadResponse,
  type GetRPCMethodsResponse as GetRPCMethodsResponseType,
  GetRPCMethodsRequest,
  RequestDownloadRequest,
  AcsResponse,
} from "./types.ts";
import Path from "./common/path.ts";

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

function getChild(xml: Element, name: string): Element | undefined {
  return xml.children.find((c) => c.localName === name);
}

function requireChild(xml: Element, name: string): Element {
  const c = getChild(xml, name);
  if (!c) throw new Error(`Missing ${name} element`);
  return c;
}

function parseBool(v: string): boolean | null {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

function event(xml: Element): string[] {
  return xml.children
    .filter((n) => n.localName === "EventStruct")
    .map((c) => requireChild(c, "EventCode").text);
}

function parameterInfoList(xml: Element): [Path, boolean, boolean][] {
  const result: [Path, boolean, boolean][] = [];
  for (const e of xml.children) {
    if (e.localName !== "ParameterInfoStruct") continue;
    let nameEl: Element | undefined;
    let writableEl: Element | undefined;
    for (const c of e.children) {
      switch (c.localName) {
        case "Name":
          nameEl = c;
          break;
        case "Writable":
          writableEl = c;
          break;
      }
    }

    let parsed = writableEl ? parseBool(writableEl.text) : null;
    if (parsed == null) {
      warnings.push({
        message: "Missing or invalid XML node",
        element: "Writable",
        parameter: nameEl?.text,
      });
      parsed = false;
    }

    try {
      if (!nameEl) throw new Error("Missing Name element");
      const param = nameEl.text;
      if (!param.endsWith(".")) result.push([Path.parse(param), false, parsed]);
      else result.push([Path.parse(param.slice(0, -1)), true, parsed]);
    } catch {
      warnings.push({
        message: "Missing or invalid XML node",
        element: "Name",
        parameter: nameEl?.text,
      });
    }
  }
  return result;
}

const getValueType = memoize((str: string) => {
  const attrs = parseAttrs(str);
  for (const attr of attrs) if (attr.localName === "type") return attr.value;

  return null;
});

function parameterValueList(
  xml: Element,
): [Path, string | number | boolean, string][] {
  const result: [Path, string | number | boolean, string][] = [];
  for (const e of xml.children) {
    if (e.localName !== "ParameterValueStruct") continue;
    let nameEl: Element | undefined;
    let valueElement: Element | undefined;
    for (const c of e.children) {
      switch (c.localName) {
        case "Name":
          nameEl = c;
          break;
        case "Value":
          valueElement = c;
          break;
      }
    }

    if (!valueElement) throw new Error("Missing Value element");

    let valueType = getValueType(valueElement.attrs);
    if (!valueType) {
      warnings.push({
        message: "Missing or invalid XML node",
        attribute: "type",
        parameter: nameEl?.text,
      });
      valueType = "xsd:string";
    }

    const value = decodeEntities(valueElement.text);
    let parsed: string | number | boolean = value;
    if (valueType === "xsd:boolean") {
      const b = parseBool(value);
      if (b == null) {
        warnings.push({
          message: "Missing or invalid XML node",
          element: "Value",
          parameter: nameEl?.text,
        });
      } else {
        parsed = b;
      }
    } else if (valueType === "xsd:int" || valueType === "xsd:unsignedInt") {
      parsed = parseInt(value);
      if (isNaN(parsed)) {
        warnings.push({
          message: "Missing or invalid XML node",
          element: "Value",
          parameter: nameEl?.text,
        });
        parsed = value;
      }
    } else if (valueType === "xsd:dateTime") {
      parsed = Date.parse(value);
      if (isNaN(parsed)) {
        warnings.push({
          message: "Missing or invalid XML node",
          element: "Value",
          parameter: nameEl?.text,
        });
        parsed = value;
      }
    }

    try {
      if (!nameEl) throw new Error("Missing Name element");
      result.push([Path.parse(nameEl.text), parsed, valueType]);
    } catch {
      warnings.push({
        message: "Missing or invalid XML node",
        element: "Name",
        parameter: nameEl?.text,
      });
    }
  }
  return result;
}

function parameterAttributeList(xml: Element): [Path, number, string[]][] {
  const result: [Path, number, string[]][] = [];
  for (const e of xml.children) {
    if (e.localName !== "ParameterAttributeStruct") continue;
    let nameEl: Element | undefined;
    let notificationElement: Element | undefined;
    let accessListElement: Element | undefined;
    for (const c of e.children) {
      switch (c.localName) {
        case "Name":
          nameEl = c;
          break;
        case "Notification":
          notificationElement = c;
          break;
        case "AccessList":
          accessListElement = c;
          break;
      }
    }

    if (!notificationElement) throw new Error("Missing Notification element");
    if (!accessListElement) throw new Error("Missing AccessList element");

    let notification = parseInt(notificationElement.text);
    if (isNaN(notification)) {
      warnings.push({
        message: "Missing or invalid XML node",
        element: "Notification",
        parameter: nameEl?.text,
      });
      notification = 0;
    }

    const accessList = accessListElement.children
      .filter((c) => c.localName === "string")
      .map((c) => decodeEntities(c.text));

    try {
      if (!nameEl) throw new Error("Missing Name element");
      result.push([Path.parse(nameEl.text), notification, accessList]);
    } catch {
      warnings.push({
        message: "Missing or invalid XML node",
        element: "Name",
        parameter: nameEl?.text,
      });
    }
  }
  return result;
}

function GetParameterNames(methodRequest: GetParameterNames): string {
  return `<cwmp:GetParameterNames><ParameterPath>${
    methodRequest.parameterPath
  }</ParameterPath><NextLevel>${+methodRequest.nextLevel}</NextLevel></cwmp:GetParameterNames>`;
}

function GetParameterNamesResponse(xml: Element): GetParameterNamesResponse {
  return {
    name: "GetParameterNamesResponse",
    parameterList: parameterInfoList(requireChild(xml, "ParameterList")),
  };
}

function GetParameterValues(methodRequest: GetParameterValues): string {
  return `<cwmp:GetParameterValues><ParameterNames soap-enc:arrayType="xsd:string[${
    methodRequest.parameterNames.length
  }]">${methodRequest.parameterNames
    .map((p: string) => `<string>${p}</string>`)
    .join("")}</ParameterNames></cwmp:GetParameterValues>`;
}

function GetParameterValuesResponse(xml: Element): GetParameterValuesResponse {
  return {
    name: "GetParameterValuesResponse",
    parameterList: parameterValueList(requireChild(xml, "ParameterList")),
  };
}

function GetParameterAttributes(methodRequest: GetParameterAttributes): string {
  return `<cwmp:GetParameterAttributes><ParameterNames soap-enc:arrayType="xsd:string[${
    methodRequest.parameterNames.length
  }]">${methodRequest.parameterNames
    .map((p: string) => `<string>${p}</string>`)
    .join("")}</ParameterNames></cwmp:GetParameterAttributes>`;
}

function GetParameterAttributesResponse(
  xml: Element,
): GetParameterAttributesResponse {
  return {
    name: "GetParameterAttributesResponse",
    parameterList: parameterAttributeList(requireChild(xml, "ParameterList")),
  };
}

function SetParameterValues(methodRequest: SetParameterValues): string {
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
  const statusEl = getChild(xml, "Status");
  let status = statusEl ? parseInt(statusEl.text) : NaN;

  if (!(status >= 0)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "Status",
    });
    status = 0;
  }

  return {
    name: "SetParameterValuesResponse",
    status: status,
  };
}

function SetParameterAttributes(methodRequest: SetParameterAttributes): string {
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
        : p[2]
            .map((s: string) => `<string>${encodeEntities(s)}</string>`)
            .join("")
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

function AddObject(methodRequest: AddObject): string {
  return `<cwmp:AddObject><ObjectName>${
    methodRequest.objectName
  }</ObjectName><ParameterKey>${
    methodRequest.parameterKey || ""
  }</ParameterKey></cwmp:AddObject>`;
}

function AddObjectResponse(xml: Element): AddObjectResponse {
  let instanceNumberEl: Element | undefined;
  let statusEl: Element | undefined;
  for (const c of xml.children) {
    switch (c.localName) {
      case "InstanceNumber":
        instanceNumberEl = c;
        break;
      case "Status":
        statusEl = c;
        break;
    }
  }

  const instanceNumber = instanceNumberEl?.text ?? "";
  let status = statusEl ? parseInt(statusEl.text) : NaN;

  if (!/^[0-9]+$/.test(instanceNumber))
    throw new Error("Missing or invalid instance number");

  if (!(status >= 0)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "Status",
    });
    status = 0;
  }

  return {
    name: "AddObjectResponse",
    instanceNumber: instanceNumber,
    status: status,
  };
}

function DeleteObject(methodRequest: DeleteObject): string {
  return `<cwmp:DeleteObject><ObjectName>${
    methodRequest.objectName
  }</ObjectName><ParameterKey>${
    methodRequest.parameterKey || ""
  }</ParameterKey></cwmp:DeleteObject>`;
}

function DeleteObjectResponse(xml: Element): DeleteObjectResponse {
  const statusEl = getChild(xml, "Status");
  let status = statusEl ? parseInt(statusEl.text) : NaN;

  if (!(status >= 0)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "Status",
    });
    status = 0;
  }

  return {
    name: "DeleteObjectResponse",
    status: status,
  };
}

function Reboot(methodRequest: Reboot): string {
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

function Download(methodRequest: Download): string {
  return `<cwmp:Download><CommandKey>${
    methodRequest.commandKey || ""
  }</CommandKey><FileType>${methodRequest.fileType}</FileType><URL>${
    methodRequest.url
  }</URL><Username>${encodeEntities(
    methodRequest.username || "",
  )}</Username><Password>${encodeEntities(
    methodRequest.password || "",
  )}</Password><FileSize>${
    methodRequest.fileSize || "0"
  }</FileSize><TargetFileName>${encodeEntities(
    methodRequest.targetFileName || "",
  )}</TargetFileName><DelaySeconds>${
    methodRequest.delaySeconds || "0"
  }</DelaySeconds><SuccessURL>${encodeEntities(
    methodRequest.successUrl || "",
  )}</SuccessURL><FailureURL>${encodeEntities(
    methodRequest.failureUrl || "",
  )}</FailureURL></cwmp:Download>`;
}

function Upload(methodRequest: Upload): string {
  return `<cwmp:Upload><CommandKey>${
    methodRequest.commandKey || ""
  }</CommandKey><FileType>${methodRequest.fileType}</FileType><URL>${
    methodRequest.url
  }</URL><Username>${encodeEntities(
    methodRequest.username || "",
  )}</Username><Password>${encodeEntities(
    methodRequest.password || "",
  )}</Password><DelaySeconds>${
    methodRequest.delaySeconds || "0"
  }</DelaySeconds><SuccessURL>${encodeEntities(
    methodRequest.successUrl || "",
  )}</SuccessURL><FailureURL>${encodeEntities(
    methodRequest.failureUrl || "",
  )}</FailureURL></cwmp:Upload>`;
}

function DownloadResponse(xml: Element): DownloadResponse {
  let statusEl: Element | undefined;
  let startTimeEl: Element | undefined;
  let completeTimeEl: Element | undefined;
  for (const c of xml.children) {
    switch (c.localName) {
      case "Status":
        statusEl = c;
        break;
      case "StartTime":
        startTimeEl = c;
        break;
      case "CompleteTime":
        completeTimeEl = c;
        break;
    }
  }

  let status = statusEl ? parseInt(statusEl.text) : NaN;
  let startTime = startTimeEl ? Date.parse(startTimeEl.text) : NaN;
  let completeTime = completeTimeEl ? Date.parse(completeTimeEl.text) : NaN;

  if (!(status >= 0)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "Status",
    });
    status = 0;
  }

  if (isNaN(startTime)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "StartTime",
    });
    startTime = Date.parse("0001-01-01T00:00:00Z");
  }

  if (isNaN(completeTime)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "CompleteTime",
    });
    completeTime = Date.parse("0001-01-01T00:00:00Z");
  }

  return {
    name: "DownloadResponse",
    status: status,
    startTime: startTime,
    completeTime: completeTime,
  };
}

function UploadResponse(xml: Element): UploadResponse {
  let statusEl: Element | undefined;
  let startTimeEl: Element | undefined;
  let completeTimeEl: Element | undefined;
  for (const c of xml.children) {
    switch (c.localName) {
      case "Status":
        statusEl = c;
        break;
      case "StartTime":
        startTimeEl = c;
        break;
      case "CompleteTime":
        completeTimeEl = c;
        break;
    }
  }

  let status = statusEl ? parseInt(statusEl.text) : NaN;
  let startTime = startTimeEl ? Date.parse(startTimeEl.text) : NaN;
  let completeTime = completeTimeEl ? Date.parse(completeTimeEl.text) : NaN;

  if (!(status >= 0)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "Status",
    });
    status = 0;
  }
  if (isNaN(startTime)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "StartTime",
    });
    startTime = Date.parse("0001-01-01T00:00:00Z");
  }

  if (isNaN(completeTime)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "CompleteTime",
    });
    completeTime = Date.parse("0001-01-01T00:00:00Z");
  }

  return {
    name: "UploadResponse",
    status: status,
    startTime: startTime,
    completeTime: completeTime,
  };
}

function Inform(xml: Element): InformRequest {
  let paramListEl: Element | undefined;
  let deviceIdEl: Element | undefined;
  let eventEl: Element | undefined;
  let retryCountEl: Element | undefined;
  for (const c of xml.children) {
    switch (c.localName) {
      case "ParameterList":
        paramListEl = c;
        break;
      case "DeviceId":
        deviceIdEl = c;
        break;
      case "Event":
        eventEl = c;
        break;
      case "RetryCount":
        retryCountEl = c;
        break;
    }
  }

  const deviceId: InformRequest["deviceId"] = {
    Manufacturer: "",
    OUI: "",
    ProductClass: "",
    SerialNumber: "",
  };
  if (deviceIdEl) {
    for (const cc of deviceIdEl.children) {
      const n = cc.localName;
      if (n in deviceId)
        deviceId[n as keyof typeof deviceId] = decodeEntities(cc.text);
    }
  }

  if (!deviceId.SerialNumber || !deviceId.OUI)
    throw new Error("Missing or invalid DeviceId element");

  let parameterList = paramListEl ? parameterValueList(paramListEl) : undefined;
  if (!parameterList) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "ParameterList",
    });
    parameterList = [];
  }

  let evnt = eventEl ? event(eventEl) : undefined;
  if (!evnt) {
    warnings.push({ message: "Missing or invalid XML node", element: "Event" });
    evnt = [];
  }

  let retryCount = retryCountEl ? parseInt(retryCountEl.text) : NaN;
  if (isNaN(retryCount)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "RetryCount",
    });
    retryCount = 0;
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

function GetRPCMethodsResponse(
  methodResponse: GetRPCMethodsResponseType,
): string {
  return `<cwmp:GetRPCMethodsResponse><MethodList soap-enc:arrayType="xsd:string[${
    methodResponse.methodList.length
  }]">${methodResponse.methodList
    .map((m: string) => `<string>${m}</string>`)
    .join("")}</MethodList></cwmp:GetRPCMethodsResponse>`;
}

function TransferComplete(xml: Element): TransferCompleteRequest {
  let commandKeyEl: Element | undefined;
  let faultStructEl: Element | undefined;
  let startTimeEl: Element | undefined;
  let completeTimeEl: Element | undefined;
  for (const c of xml.children) {
    switch (c.localName) {
      case "CommandKey":
        commandKeyEl = c;
        break;
      case "FaultStruct":
        faultStructEl = c;
        break;
      case "StartTime":
        startTimeEl = c;
        break;
      case "CompleteTime":
        completeTimeEl = c;
        break;
    }
  }

  let commandKey = commandKeyEl?.text;
  if (commandKey == null) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "CommandKey",
    });
    commandKey = "";
  }

  let _faultStruct = faultStructEl ? faultStruct(faultStructEl) : undefined;
  if (!_faultStruct) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "FaultStruct",
    });
    _faultStruct = { faultCode: "0", faultString: "" };
  }

  let startTime = startTimeEl ? Date.parse(startTimeEl.text) : NaN;
  if (isNaN(startTime)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "StartTime",
    });
    startTime = Date.parse("0001-01-01T00:00:00Z");
  }

  let completeTime = completeTimeEl ? Date.parse(completeTimeEl.text) : NaN;
  if (isNaN(completeTime)) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "CompleteTime",
    });
    completeTime = Date.parse("0001-01-01T00:00:00Z");
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
    fileType: requireChild(xml, "FileType").text,
  };
}

function RequestDownloadResponse(): string {
  return "<cwmp:RequestDownloadResponse></cwmp:RequestDownloadResponse>";
}

function AcsFault(f: CpeFault): string {
  const detail = f.detail;
  if (!detail) throw new Error("CpeFault.detail missing");
  return `<soap-env:Body:Fault><faultcode>${encodeEntities(
    f.faultCode,
  )}</faultcode><faultstring>${encodeEntities(
    f.faultString,
  )}</faultstring><detail><cwmp:Fault><FaultCode>${encodeEntities(
    detail.faultCode,
  )}</FaultCode><FaultString>${encodeEntities(
    detail.faultString,
  )}</FaultString></cwmp:Fault></detail></soap-env:Body:Fault>`;
}

function faultStruct(xml: Element): FaultStruct {
  let faultCodeEl: Element | undefined;
  let faultStringEl: Element | undefined;
  let setParameterValuesFault: SpvFault[] | undefined;

  for (const c of xml.children) {
    switch (c.localName) {
      case "FaultCode":
        faultCodeEl = c;
        break;
      case "FaultString":
        faultStringEl = c;
        break;
      case "SetParameterValuesFault": {
        let pnEl: Element | undefined;
        let fcEl: Element | undefined;
        let fsEl: Element | undefined;
        for (const cc of c.children) {
          switch (cc.localName) {
            case "ParameterName":
              pnEl = cc;
              break;
            case "FaultCode":
              fcEl = cc;
              break;
            case "FaultString":
              fsEl = cc;
              break;
          }
        }
        setParameterValuesFault = setParameterValuesFault ?? [];
        setParameterValuesFault.push({
          parameterName: pnEl?.text ?? "",
          faultCode: fcEl?.text ?? "",
          faultString: fsEl ? decodeEntities(fsEl.text) : "",
        });
        break;
      }
    }
  }

  let faultCode = faultCodeEl?.text;
  if (faultCode == null) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "FaultCode",
    });
    faultCode = "";
  }

  let faultString = faultStringEl
    ? decodeEntities(faultStringEl.text)
    : undefined;
  if (faultString == null) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "FaultString",
    });
    faultString = "";
  }

  return { faultCode, faultString, setParameterValuesFault };
}

function fault(xml: Element): CpeFault {
  let faultCodeEl: Element | undefined;
  let faultStringEl: Element | undefined;
  let detailEl: Element | undefined;
  for (const c of xml.children) {
    switch (c.localName) {
      case "faultcode":
        faultCodeEl = c;
        break;
      case "faultstring":
        faultStringEl = c;
        break;
      case "detail":
        detailEl = c;
        break;
    }
  }

  if (!detailEl) throw new Error("Missing detail element");
  const detail = faultStruct(requireChild(detailEl, "Fault"));

  let faultCode = faultCodeEl?.text;
  if (faultCode == null) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "faultcode",
    });
    faultCode = "Client";
  }

  let faultString = faultStringEl
    ? decodeEntities(faultStringEl.text)
    : undefined;
  if (faultString == null) {
    warnings.push({
      message: "Missing or invalid XML node",
      element: "faultstring",
    });
    faultString = "CWMP fault";
  }

  return { faultCode, faultString, detail } as CpeFault;
}

export function request(
  body: string,
  warn: Record<string, unknown>[],
): SoapMessage {
  warnings = warn;

  const rpc: SoapMessage = {
    id: "",
    cwmpVersion: "",
    sessionTimeout: 0,
    cpeRequest: undefined,
    cpeFault: undefined,
    cpeResponse: undefined,
    unknownMethod: undefined,
  };

  if (!body.length) return rpc;

  const xml = parseXml(body);

  if (!xml.children.length) return rpc;

  const envelope = xml.children[0];

  let headerElement: Element | undefined;
  let bodyElement: Element | undefined;
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
  if (!bodyElement) throw new Error("Missing SOAP Body element");

  if (headerElement) {
    let idEl: Element | undefined;
    let sessionTimeoutEl: Element | undefined;
    for (const c of headerElement.children) {
      switch (c.localName) {
        case "ID":
          idEl = c;
          break;
        case "sessionTimeout":
          sessionTimeoutEl = c;
          break;
      }
    }
    if (idEl) rpc.id = decodeEntities(idEl.text);
    if (sessionTimeoutEl) rpc.sessionTimeout = parseInt(sessionTimeoutEl.text);
  }

  const methodElement = bodyElement.children[0];

  if (methodElement.localName === "Inform") {
    let namespace: string | undefined, namespaceHref: string | undefined;
    for (const e of [methodElement, bodyElement, envelope]) {
      namespace = namespace || e.namespace;
      if (e.attrs) {
        const attrs = memoizedParseAttrs(e.attrs);
        const attr = namespace
          ? attrs.find(
              (s) => s.namespace === "xmlns" && s.localName === namespace,
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
    case "UploadResponse":
      rpc.cpeResponse = UploadResponse(methodElement);
      break;
    case "Fault":
      rpc.cpeFault = fault(methodElement);
      break;
    default:
      rpc.unknownMethod = methodElement.localName;
      break;
  }

  return rpc;
}

const namespacesAttrs: Record<string, string> = {
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

export function response(
  rpc: {
    id: string;
    cwmpVersion: string;
    acsRequest?: AcsRequest;
    acsResponse?: AcsResponse;
    acsFault?: CpeFault;
  } | null,
): { code: number; headers: Record<string, string>; data: string } {
  const headers: Record<string, string> = {
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
          }`,
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
      case "Upload":
        body = Upload(rpc.acsRequest);
        break;
      default:
        throw new Error(
          `Unknown method request ${(rpc.acsRequest as AcsRequest).name}`,
        );
    }
  } else if (rpc.acsFault) {
    body = AcsFault(rpc.acsFault);
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
