/**
 * Headers that describe a body, not the message they are copied onto: Hono merges them into an error response, where a
 * stale Content-Length or Content-Encoding breaks the body (#272), and a contract response re-serializes the handler's
 * value, so a handler's own ones never describe the body it sends (H4 #107). The offload ones (`X-Accel-Redirect` for
 * nginx, `X-Sendfile` and `X-Sendfile-Temporary` for Apache, `X-Sendfile2` and `X-Lighttpd-Send-File` for lighttpd,
 * `X-LiteSpeed-Location` for LiteSpeed, `X-Reproxy-URL` for reproxy) make the server send a file in place of the error
 * body when a handler sets one before it throws (H29 #295, H32 #312)
 */
export const BODY_HEADERS = [
  "Content-Type", "Content-Length", "Content-Encoding", "Content-Range", "Content-Disposition", "Content-Location",
  "Content-Digest", "Repr-Digest", "Digest", "Content-MD5", "Transfer-Encoding", "Trailer",
  "X-Accel-Redirect", "X-Sendfile", "X-Sendfile-Temporary", "X-Sendfile2", "X-Reproxy-URL", "X-Lighttpd-Send-File",
  "X-LiteSpeed-Location",
];

/**
 * Headers that send the client elsewhere rather than describe a body (`Location`, RFC 9110 §10.2.2, and `Refresh`). A
 * contract response builds its own body, so it drops them, except a 201's `Location`: it names the created resource
 * (§15.3.2), and `Content-Location` (§8.7) with it (H32 #312)
 */
export const REDIRECT_HEADERS = ["Location", "Refresh"];

const BODY_HEADER_NAMES = new Set(BODY_HEADERS.map((name) => name.toLowerCase()));
const REDIRECT_HEADER_NAMES = new Set(REDIRECT_HEADERS.map((name) => name.toLowerCase()));

/** Whether `name`, in any case, describes a body rather than the message being written */
export const isBodyHeader = (name: string) => BODY_HEADER_NAMES.has(name.toLowerCase());

/** Whether `name`, in any case, sends the client elsewhere rather than describing a body */
export const isRedirectHeader = (name: string) => REDIRECT_HEADER_NAMES.has(name.toLowerCase());
