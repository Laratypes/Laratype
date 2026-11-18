/**
 * Headers that describe a body or a redirect, not the message they are copied onto: Hono merges them into an error
 * response, where a stale Content-Length or Content-Encoding breaks the body (#272), and a contract response
 * re-serializes the handler's value, so a handler's own ones never describe the body it sends (H4 #107). The offload
 * ones (`X-Accel-Redirect` for nginx, `X-Sendfile` for Apache, ...) make the server send a file in place of the error
 * body when a handler sets one before it throws (H29 #295)
 */
export const BODY_HEADERS = [
  "Content-Type", "Content-Length", "Content-Encoding", "Content-Range", "Content-Disposition", "Content-Location",
  "Content-Digest", "Repr-Digest", "Digest", "Content-MD5", "Location", "Refresh", "Transfer-Encoding", "Trailer",
  "X-Accel-Redirect", "X-Sendfile", "X-Lighttpd-Send-File", "X-LiteSpeed-Location",
];

const BODY_HEADER_NAMES = new Set(BODY_HEADERS.map((name) => name.toLowerCase()));

/** Whether `name`, in any case, describes a body or a redirect rather than the message being written */
export const isBodyHeader = (name: string) => BODY_HEADER_NAMES.has(name.toLowerCase());
