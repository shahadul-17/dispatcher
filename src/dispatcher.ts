import { IChildProcess, ChildProcess, ChildProcessEventType, ChildProcessEventArguments, } from "./child-process";
import { NumberUtilities, ObjectUtilities, StringUtilities, ThreadUtilities } from "@shahadul-17/utilities";
import { UIDGenerator } from "@shahadul-17/uid-generator";
import { IMap, Map } from "@shahadul-17/collections";
import { DispatcherOptions } from "./dispatcher-options.t";
import { IDispatcher } from "./dispatcher.i";
import { DispatchableTaskInformation } from "./dispatchable-task-information.t";
import { DispatcherError } from "./dispatcher-error";
import { DispatcherIpcPayload } from "./dispatcher-ipc-payload.t";
import { DispatcherIpcFlag } from "./dispatcher-ipc-flag.e";

export class Dispatcher implements IDispatcher {

  private _isStarted: boolean = false;
  private childProcessIndex: number = 0;
  private readonly options: DispatcherOptions;
  private readonly uidGenerator = UIDGenerator.create();
  private readonly childProcesses: Array<IChildProcess>;
  private readonly childProcessResponseMap: IMap<string, DispatcherIpcPayload> = new Map<string, DispatcherIpcPayload>();

  private constructor(options: DispatcherOptions) {
    this.options = options;
    this.childProcesses = new Array<IChildProcess>(options.processCount);

    // binding methods to current instance...
    this.isStarted = this.isStarted.bind(this);
    this.getProcessCount = this.getProcessCount.bind(this);
    this.getThreadCountPerProcess = this.getThreadCountPerProcess.bind(this);
    this.dispatchAsync = this.dispatchAsync.bind(this);
    this.startAsync = this.startAsync.bind(this);
    this.stopAsync = this.stopAsync.bind(this);
    this.onEventOccurredAsync = this.onEventOccurredAsync.bind(this);
  }

  public isStarted(): boolean {
    return this._isStarted;
  }

  public getProcessCount(): number {
    return this.options.processCount;
  }

  public getThreadCountPerProcess(): number {
    return this.options.threadCountPerProcess;
  }

  private async getChildProcessByIndex(index: number): Promise<IChildProcess> {
    if (index < 0 || index >= this.childProcesses.length) {
      throw new Error(`Child process index ${index} is out of bounds.`);
    }

    const childProcess = this.childProcesses[index];

    return childProcess;
  }

  private async getNextChildProcessAsync(): Promise<IChildProcess> {
    const childProcess = this.getChildProcessByIndex(this.childProcessIndex);

    ++this.childProcessIndex;

    // if child process index is less than the array length, we shall return the child process...
    if (this.childProcessIndex < this.childProcesses.length) { return childProcess; }

    // otherwise, we shall reset the index...
    this.childProcessIndex = 0;

    // and return the child process instance...
    return childProcess;
  }

  public async dispatchAsync<Type>(taskInformation: DispatchableTaskInformation): Promise<Type> {
    const taskId = this.uidGenerator.generate();
    const childProcess = await this.getNextChildProcessAsync();
    // we'll send the internal task information to the child process...
    const isSent = await childProcess.sendAsync<DispatcherIpcPayload>({
      flag: DispatcherIpcFlag.Dispatch,
      taskId: taskId,
      methodName: taskInformation.methodName,
      methodArguments: taskInformation.methodArguments,
      serviceName: taskInformation.serviceType.name,
      childProcessIndex: -1,
      result: childProcess.getOptions().childProcessIndex,
    });

    if (!isSent) { throw new Error(`An error occurred while communicating to child process with index ${childProcess.getOptions().childProcessIndex}`); }

    let response: undefined | DispatcherIpcPayload;

    // we want to wait until we receive response from the child process...
    await ThreadUtilities.waitAsync(async () => {
      response = this.childProcessResponseMap.get(taskId);

      // we shall stop waiting once we have the response...
      const shallCancel = ObjectUtilities.isObject(response);

      // returning true will break the wait... 
      return shallCancel;
    });

    response = response!;

    if (response.flag === DispatcherIpcFlag.Error) {
      throw new DispatcherError(response.result);
    }

    return response.result;
  }

  private async onChildProcessResponseReceivedAsync(response: DispatcherIpcPayload): Promise<void> {
    console.log(response);

    if (response.flag === DispatcherIpcFlag.Dispatch) {
      this.childProcessResponseMap.set(response.taskId, response);
    }
    if (response.flag === DispatcherIpcFlag.Error) {
      // if response does not contain task id...
      if (StringUtilities.isUndefinedOrNullOrEmpty(response.taskId, true)) {
        console.log("An error occurred.", response.result);

        return;
      }

      this.childProcessResponseMap.set(response.taskId, response);
    }
  }

  private async onEventOccurredAsync(eventArguments: ChildProcessEventArguments): Promise<void> {
    console.log('EVENT OCCURRED...', eventArguments);

    if (eventArguments.type === ChildProcessEventType.Spawn) {
      console.log(`Child process with index ${eventArguments.childProcessIndex} has spawned.`);
    } else if (eventArguments.type === ChildProcessEventType.DataReceive) {
      if (!ObjectUtilities.isObject(eventArguments.data)) { return; }

      const response = eventArguments.data as DispatcherIpcPayload;

      if (NumberUtilities.isPositiveNumber(response.flag)) {
        console.log(`[Child Process ${eventArguments.childProcessIndex}]: ${eventArguments.dataAsString}.`);

        return;
      }

      await this.onChildProcessResponseReceivedAsync(response);
    }
  }

  public async startAsync(): Promise<void> {
    if (this._isStarted) { return; }

    this._isStarted = true;

    const promises: Array<Promise<IChildProcess>> = [];

    const eventTypes = [
      ChildProcessEventType.Spawn,
      ChildProcessEventType.Disconnect,
      ChildProcessEventType.DataReceive,
      ChildProcessEventType.Error,
      ChildProcessEventType.Exit,
      ChildProcessEventType.Close,
    ];

    for (let i = 0; i < this.options.processCount; ++i) {
      const childProcess: IChildProcess = new ChildProcess({
        childProcessIndex: i,
        childProcessFileNameWithoutExtension: "dispatcher-child-process",
      });

      for (const eventType of eventTypes) {
        childProcess.addEventListener(eventType, this.onEventOccurredAsync);
      }

      promises.push(childProcess.spawnAsync());
    }

    let childProcesses;

    try {
      childProcesses = await Promise.all(promises);
    } catch (error) {
      this._isStarted = false;

      throw error;
    }

    for (let i = 0; i < childProcesses.length; ++i) {
      this.childProcesses[i] = childProcesses[i];
    }
  }

  public async stopAsync(): Promise<void> {
    this._isStarted = false;
  }

  public static createInstance(options: DispatcherOptions): IDispatcher {
    const dispatcher = new Dispatcher(options);

    return dispatcher;
  }
}
