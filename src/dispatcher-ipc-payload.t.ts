import { DispatcherIpcFlag } from "./dispatcher-ipc-flag.e";

export type DispatcherIpcPayload = {
  flag: DispatcherIpcFlag,
  childProcessIndex: number,
  taskId: string,
  result: any,
  serviceName: string,
  methodName: string,
  methodArguments?: Array<any>,
};
