export const PROTOCOL_VERSION = 1;

export const ErrorCode = {
  InvalidParams: 400,
  Denied: 403,
  NotFound: 404,
  Internal: 500,
  BadResponse: 502,
  NotConnected: 503,
  Timeout: 504,
} as const;

export const CloseCode = {
  Malformed: 4000,
  Replaced: 4001,
  Closed: 4002,
  Unauthorized: 4003,
  UnsupportedVersion: 4004,
} as const;

export class ToolCallError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ToolCallError';
  }
}
