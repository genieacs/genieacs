import * as url from "node:url";
import { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough, pipeline, Readable } from "node:stream";
import { createHash } from "node:crypto";
import { filesBucket, collections } from "./db/db.ts";
import * as logger from "./logger.ts";
import { getRequestOrigin } from "./forwarded.ts";
import memoize from "./common/memoize.ts";

const getFile = memoize(
  async (
    etag: string,
    size: number,
    filename: string,
  ): Promise<Iterable<Buffer>> => {
    const chunks: Buffer[] = [];
    // Using for-await over the download stream can throw ERR_STREAM_PREMATURE_CLOSE
    // for very small files. Possibly a bug in MongoDB driver or Nodejs itself.
    // Using a PassThrough stream to avoid this.
    const downloadStream = pipeline(
      filesBucket.openDownloadStreamByName(filename),
      new PassThrough(),
      (err) => {
        if (err) throw err;
      },
    );
    for await (const chunk of downloadStream) chunks.push(chunk);
    // Node 12-14 don't throw error when stream is closed prematurely.
    // However, we don't need to check for that since we're checking file size.
    if (size !== chunks.reduce((a, b) => a + b.length, 0))
      throw new Error("File size mismatch");
    return chunks;
  },
);

async function* partialContent(
  chunks: Iterable<Buffer>,
  start: number,
  end: number,
): AsyncIterable<Buffer> {
  let bytesToSkip = start;
  let bytesToRead = end - start;

  for (let chunk of chunks) {
    if (bytesToRead <= 0) return;
    if (bytesToSkip >= chunk.length) {
      bytesToSkip -= chunk.length;
      continue;
    }
    chunk = chunk.subarray(bytesToSkip, bytesToSkip + bytesToRead);
    bytesToRead -= chunk.length;
    bytesToSkip = 0;
    yield chunk;
  }
}

function generateETag(file: {
  _id: string;
  uploadDate: Date;
  length: number;
}): string {
  const hash = createHash("md5");
  hash.update(`${file._id}-${file.uploadDate.getTime()}-${file.length}`);
  return hash.digest("hex");
}

function matchEtag(etag: string, header: string): boolean {
  for (let t of header.split(",")) {
    t = t.trim();
    if (t.startsWith("W/")) t = t.substring(2);
    try {
      t = JSON.parse(t);
    } catch (e) {
      // Ignore
    }
    if (t === "*") return true;
    if (etag === t) return true;
  }
  return false;
}

export async function listener(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("405 Method Not Allowed");
    return;
  }

  const urlParts = url.parse(request.url, true);
  const filename = decodeURIComponent(urlParts.pathname.substring(1));

  const log = {
    message: "Fetch file",
    filename: filename,
    remoteAddress: getRequestOrigin(request).remoteAddress,
    method: request.method,
  };

  const file = await collections.files.findOne({ _id: filename });

  if (!file) {
    response.writeHead(404);
    response.end();
    log.message += " not found";
    logger.accessError(log);
    return;
  }

  logger.accessInfo(log);

  const etag = generateETag(file);
  const lastModified = file["uploadDate"];
  lastModified.setMilliseconds(0);

  let status = 200;
  let start = 0;
  let end = file.length;

  if (request.headers["if-match"])
    if (!matchEtag(etag, request.headers["if-match"])) status = 412;

  if (request.headers["if-unmodified-since"]) {
    const d = new Date(request.headers["if-unmodified-since"]);
    if (lastModified > d) status = 412;
  }

  if (request.headers["if-none-match"]) {
    if (matchEtag(etag, request.headers["if-none-match"])) status = 304;
  } else if (request.headers["if-modified-since"]) {
    const d = new Date(request.headers["if-modified-since"]);
    if (lastModified <= d) status = 304;
  }

  if (request.headers.range && status === 200) {
    const match = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    status = 416;
    if (match && (match[1] || match[2])) {
      if (match[2]) end = parseInt(match[2]) + 1;
      if (match[1]) start = parseInt(match[1]);
      else start = file.length - parseInt(match[2]);
      if (start < end && end <= file.length) status = 206;
    }

    if (request.headers["if-range"]) {
      const h = request.headers["if-range"] as string;
      const d = new Date(h);
      if (!matchEtag(etag, h) && !(lastModified <= d)) {
        status = 200;
        start = 0;
        end = file.length;
      }
    }
  }

  if (status === 412) {
    response.writeHead(412);
    response.end();
    return;
  }

  if (status === 304) {
    response.writeHead(304, {
      ETag: etag,
      "Last-Modified": lastModified.toUTCString(),
    });
    response.end();
    return;
  }

  if (status === 416) {
    response.writeHead(416, {
      "Content-Range": `bytes */${file.length}`,
      "Content-Length": "0",
    });
    response.end();
    return;
  }

  response.writeHead(status, {
    "Content-Type": "application/octet-stream",
    "Content-Length": end - start,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": lastModified.toUTCString(),
    ...(status === 206 && {
      "Content-Range": `bytes ${start}-${end - 1}/${file.length}`,
    }),
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const chunks = await getFile(etag, file.length, filename);

  pipeline(Readable.from(partialContent(chunks, start, end)), response, () => {
    // Ignore errors resulting from client disconnecting
  });
}
