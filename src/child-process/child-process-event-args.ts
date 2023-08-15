import { IEventArguments } from "@shahadul-17/event-manager";
import { ChildProcessEventType } from "./child-process-event-type.e";
import { ObjectUtilities, StringUtilities } from "@shahadul-17/utilities";

export class ChildProcessEventArguments implements IEventArguments<ChildProcessEventType> {
  public type: ChildProcessEventType = ChildProcessEventType.None;
  public childProcessIndex: number = -1;
  // public rawData: any = ObjectUtilities.getEmptyObject();
  // public dataAsString: string = StringUtilities.getEmptyString();
  public isErrorData: boolean = false;
  public data: any = ObjectUtilities.getEmptyObject();
  public error?: Error;
  public exitCode?: null | number;
  public exitSignal?: null | NodeJS.Signals;
}
