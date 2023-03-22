import * as config from "./config";
import { SessionContext } from "./types";
import * as debug from "./debug";
import { BlockList } from "net";
import { getRequestOrigin } from "./forwarded";
import { IncomingMessage, ServerResponse } from "http";
import * as logger from "./logger";

const ALLOWED = config.get("ALLOW_FROM");

const allowedList = new BlockList();
const allowedArray: Array<string> = [];
if (typeof ALLOWED === "string") {
  const ALLOWEDString = (ALLOWED as string).trim();

  if (
    ALLOWEDString !== "any" &&
    ALLOWEDString !== "ANY" &&
    ALLOWEDString !== "all" &&
    ALLOWEDString !== "ALL"
  ) {
    if (ALLOWEDString.includes(",") === true) {
      ALLOWEDString.split(",").map((n) => {
        const nn = String(n);
        allowedArray.push(nn);
      });
    } else {
      allowedArray.push(ALLOWEDString);
    }

    allowedArray.forEach((value) => {
      const stringValue = value as string;
      const parsed = stringValue.trim().split("/", 2);
      const parsed1: number = +parsed[1];
      try {
        if (parsed1 > 0 && parsed1 < 33)
          allowedList.addSubnet(parsed[0], parsed1, "ipv4");
        else allowedList.addAddress(parsed[0]);
      } catch (error) {
        console.log("Error adding " + parsed[0]);
      }
    });
  }
}

export async function allowed(
  sessionContext: SessionContext
): Promise<boolean> {
  if (allowedArray.length === 0) return true;
  if (allowedList.check(sessionContext.httpRequest.socket.remoteAddress))
    return true;
  const httpResponse = sessionContext.httpResponse;
  const body = "Forbidden";
  const resHeaders = {};
  resHeaders["Connection"] = "close";

  httpResponse.setHeader("Content-Length", Buffer.byteLength(body));
  httpResponse.writeHead(403, resHeaders);
  if (sessionContext.debug)
    debug.outgoingHttpResponse(httpResponse, sessionContext.deviceId, body);
  httpResponse.end(body);

  logger.accessWarn({
    sessionContext: sessionContext,
    message: "403 Forbidden, not in out allow list ",
    parameter: sessionContext.httpRequest.socket.remoteAddress,
  });

  return false;
}

export async function allowedFS(
  request: IncomingMessage,
  response: ServerResponse
): Promise<boolean> {
  if (allowedArray.length === 0) return true;

  if (allowedList.check(request.socket.remoteAddress)) return true;
  const httpResponse = response;
  const body = "Forbidden";
  const resHeaders = {};
  resHeaders["Connection"] = "close";

  httpResponse.setHeader("Content-Length", Buffer.byteLength(body));
  httpResponse.writeHead(403, resHeaders);
  httpResponse.end(body);
  const log = {
    message: "Fetch file 403 Forbidden",
    filename: "",
    remoteAddress: getRequestOrigin(request).remoteAddress,
  };
  logger.accessError(log);

  return false;
}
