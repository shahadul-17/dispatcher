import { IEventManager } from "@shahadul-17/event-manager";
import { ChildProcessOptions } from "./child-process-options.t";
import { ChildProcessEventType } from "./child-process-event-type.e";
import { ChildProcessEventArguments } from "./child-process-event-args";

export interface IChildProcess extends IEventManager<ChildProcessEventType, ChildProcessEventArguments> {
  isChildProcess(): boolean;
  getChildProcessIndex(): number;
  getOptions(): ChildProcessOptions;
  spawnAsync(): Promise<IChildProcess>;
  sendAsync<Type>(data: Type): Promise<boolean>;
}
