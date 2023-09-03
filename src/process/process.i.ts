import { IEventManager } from "@shahadul-17/event-manager";
import { ProcessOptions } from "./process-options.t";
import { ProcessEventType } from "./process-event-type.e";
import { IProcessEventArguments } from "./process-event-args.i";

export interface IProcess extends IEventManager<ProcessEventType, IProcessEventArguments> {
  get isChildProcess(): boolean;
  get processId(): undefined | number;
  get taskCount(): number;
  get options(): ProcessOptions;

  incrementTaskCount(step?: number): number;
  decrementTaskCount(step?: number): number;
  spawnAsync(): Promise<IProcess>;
  sendAsync<Type>(data: Type): Promise<boolean>;
}
