import { IEventArguments } from "@shahadul-17/event-manager";
import { ProcessEventType } from "./process-event-type.e";

export interface IProcessEventArguments extends IEventArguments<ProcessEventType> {
  processId?: number;
  data?: any;
  error?: Error;
  exitCode?: number;
  exitSignal?: NodeJS.Signals;
}
