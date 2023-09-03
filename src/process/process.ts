import { EventListener, IEventManager } from "@shahadul-17/event-manager";
import { IProcess } from "./process.i";
import { ProcessEventType } from "./process-event-type.e";
import { IProcessEventArguments } from "./process-event-args.i";
import { ProcessOptions } from "./process-options.t";
import { ArgumentsParser, ObjectUtilities } from "@shahadul-17/utilities";
import { ParentProcess } from "./parent-process";
import { ChildProcess } from "./child-process";

export class Process implements IProcess {

  private readonly process: IProcess;

  constructor(options?: ProcessOptions) {
    const isChildProcess = ArgumentsParser.getArgument("isChildProcess") === "true";

    options = ObjectUtilities.isObject(options)
      ? options
      : ObjectUtilities.getEmptyObject(true);

    this.process = isChildProcess
      ? new ParentProcess(options!)
      : new ChildProcess(options!);

    // binding methods...
    this.incrementTaskCount = this.incrementTaskCount.bind(this);
    this.decrementTaskCount = this.decrementTaskCount.bind(this);
    this.spawnAsync = this.spawnAsync.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
    this.addEventListener = this.addEventListener.bind(this);
    this.removeEventListener = this.removeEventListener.bind(this);
    this.removeEventListeners = this.removeEventListeners.bind(this);
    this.copyEventListeners = this.copyEventListeners.bind(this);
  }

  public get isChildProcess(): boolean {
    return this.process.isChildProcess;
  }

  public get taskCount(): number {
    return this.process.taskCount;
  }

  public get processId(): undefined | number {
    return this.process.processId;
  }

  public get options(): ProcessOptions {
    return this.process.options;
  }

  public incrementTaskCount(step?: number): number {
    return this.process.incrementTaskCount(step);
  }

  public decrementTaskCount(step?: number): number {
    return this.process.decrementTaskCount(step);
  }

  public spawnAsync(): Promise<IProcess> {
    return this.process.spawnAsync();
  }

  public sendAsync<Type>(data: Type): Promise<boolean> {
    return this.process.sendAsync(data);
  }

  public addEventListener(type: ProcessEventType,
    listener: EventListener<ProcessEventType, IProcessEventArguments>): boolean {
    return this.process.addEventListener(type, listener);
  }

  public removeEventListener(listener: EventListener<ProcessEventType, IProcessEventArguments>,
    type?: ProcessEventType | undefined, removeAll?: boolean | undefined): boolean {
    return this.process.removeEventListener(listener, type, removeAll);
  }

  public removeEventListeners(type?: ProcessEventType | undefined): void {
    return this.process.removeEventListeners(type);
  }

  public copyEventListeners(eventManager: IEventManager<ProcessEventType, IProcessEventArguments>,
    type?: ProcessEventType | undefined): boolean {
    return this.process.copyEventListeners(eventManager, type);
  }
}
