import { DispatcherIpcPayloadFlag } from "./dispatcher-ipc-payload-flag.e";

export type DispatcherIpcPayload = {
  flag: DispatcherIpcPayloadFlag,
  processId?: number,
  payloadId?: string,
  result?: any,
  serviceName?: string,
  serviceScopeName?: string,
  methodName?: string,
  methodArguments?: Array<any>,
};
