import { IChildProcess, ChildProcess, ChildProcessEventType, ChildProcessEventArguments, } from "./child-process";
import { NumberUtilities, ObjectUtilities, StringUtilities, ThreadUtilities } from "@shahadul-17/utilities";
import { UIDGenerator } from "@shahadul-17/uid-generator";
import { IMap, IQueue, Map, Queue, } from "@shahadul-17/collections";
import { DispatcherOptions } from "./dispatcher-options.t";
import { IDispatcher } from "./dispatcher.i";
import { DispatchableTaskInformation } from "./dispatchable-task-information.t";
import { DispatcherError } from "./dispatcher-error";
import { DispatcherIpcPayload } from "./dispatcher-ipc-payload.t";
import { DispatcherIpcFlag } from "./dispatcher-ipc-flag.e";

const IPC_PAYLOAD_QUEUE_PROCESSOR_SLEEP_TIMEOUT_IN_MILLISECONDS = 5;
const WAITING_THREAD_SLEEP_TIMEOUT_IN_MILLISECONDS = 5;
const QUEUE_INITIAL_CAPACITY = 4096;
const CHILD_PROCESS_FILE_NAME_WITHOUT_EXTENSION = "dispatcher-child-process";

export class Dispatcher implements IDispatcher {
  private _isStarted: boolean = false;
  private lastChildProcessIndex: number = 0;
  private readonly options: DispatcherOptions;
  private readonly interval: NodeJS.Timer;
  private readonly uidGenerator = UIDGenerator.create();
  private readonly childProcessesBusyStatus: Array<boolean>;
  private readonly childProcessesTaskCount: Array<number>;
  private readonly childProcesses: Array<IChildProcess>;
  private readonly ipcPayloadQueue: IQueue<DispatcherIpcPayload> = new Queue<DispatcherIpcPayload>(QUEUE_INITIAL_CAPACITY);
  private readonly childProcessResponseMap: IMap<string, DispatcherIpcPayload> = new Map<string, DispatcherIpcPayload>();

  private constructor(options: DispatcherOptions) {
    this.options = options;
    this.options.dispatcherServiceInitializerPath = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
      this.options.dispatcherServiceInitializerPath, StringUtilities.getEmptyString(), true);

    if (StringUtilities.isEmpty(this.options.dispatcherServiceInitializerPath)) {
      throw new Error("Dispatcher service initializer path must be provided.");
    }

    this.options.dispatcherServiceInitializerPath = `"${this.options.dispatcherServiceInitializerPath}"`;
    this.childProcessesBusyStatus = new Array<boolean>(options.processCount);
    this.childProcessesTaskCount = new Array<number>(options.processCount);
    this.childProcesses = new Array<IChildProcess>(options.processCount);

    // binding methods to current instance...
    this.isStarted = this.isStarted.bind(this);
    this.getProcessCount = this.getProcessCount.bind(this);
    this.getThreadCountPerProcess = this.getThreadCountPerProcess.bind(this);
    this.getChildProcessByIndex = this.getChildProcessByIndex.bind(this);
    this.getNextAvailableChildProcessAsync = this.getNextAvailableChildProcessAsync.bind(this);
    this.dispatchAsync = this.dispatchAsync.bind(this);
    this.onChildProcessResponseReceivedAsync = this.onChildProcessResponseReceivedAsync.bind(this);
    this.onEventOccurredAsync = this.onEventOccurredAsync.bind(this);
    this.startAsync = this.startAsync.bind(this);
    this.processIpcPayloadQueueAsync = this.processIpcPayloadQueueAsync.bind(this);
    this.stopAsync = this.stopAsync.bind(this);

    this.interval = setInterval(this.processIpcPayloadQueueAsync,
      IPC_PAYLOAD_QUEUE_PROCESSOR_SLEEP_TIMEOUT_IN_MILLISECONDS);
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

  private setChildProcessBusyStatusByIndex(isBusy: boolean, index: number): void {
    if (index < 0 || index >= this.childProcessesBusyStatus.length) {
      throw new Error(`Child process index ${index} is out of bounds.`);
    }

    this.childProcessesBusyStatus[index] = isBusy;
  }

  private incrementChildProcessTaskCountByIndex(index: number): void {
    if (index < 0 || index >= this.childProcessesBusyStatus.length) {
      throw new Error(`Child process index ${index} is out of bounds.`);
    }

    ++this.childProcessesTaskCount[index];
  }

  private decrementChildProcessTaskCountByIndex(index: number): void {
    if (index < 0 || index >= this.childProcessesBusyStatus.length) {
      throw new Error(`Child process index ${index} is out of bounds.`);
    }

    --this.childProcessesTaskCount[index];
  }

  private async getChildProcessByIndex(index: number): Promise<IChildProcess> {
    if (index < 0 || index >= this.childProcesses.length) {
      throw new Error(`Child process index ${index} is out of bounds.`);
    }

    const childProcess = this.childProcesses[index];

    return childProcess;
  }

  private async getNextAvailableChildProcessAsync(): Promise<undefined | IChildProcess> {
    // we shall iterate over all the child processes...
    // for (let i = this.lastChildProcessIndex, count = 0; ; ++i, ++count) {
    //   if (count == this.childProcesses.length) { break; }
    //   if (i == this.childProcesses.length) { i = 0; }

    //   // if the child process on the specified index is busy, we shall continue...
    //   if (this.childProcessesBusyStatus[i] === true) { continue; }

    //   // otherwise we shall set the last child process index...
    //   this.lastChildProcessIndex = i;

    //   console.log('SELECTED CHILD INDEX: ', this.lastChildProcessIndex);

    //   // and we'll also set the busy status to true...
    //   this.childProcessesBusyStatus[i] = true;

    //   return this.childProcesses[i];
    // }

    let childIndexWithMinimumTaskCount = -1;
    let minimumTaskCount = 0;

    // we shall iterate over all the child processes...
    for (let i = 0; i < this.childProcesses.length; ++i) {
      // if the child process on the specified index is busy, we shall continue...
      if (this.childProcessesBusyStatus[i] === true) { continue; }
      // if minimum task count is greater than the task count of the current index...
      if (minimumTaskCount >= this.childProcessesTaskCount[i]) {
        childIndexWithMinimumTaskCount = i;
        minimumTaskCount = this.childProcessesTaskCount[i];
      }
    }

    if (childIndexWithMinimumTaskCount === -1) { return undefined; }

    // otherwise we shall set the busy status to true...
    this.childProcessesBusyStatus[childIndexWithMinimumTaskCount] = true;
    ++this.childProcessesTaskCount[childIndexWithMinimumTaskCount];

    return this.childProcesses[childIndexWithMinimumTaskCount];
  }

  public async dispatchAsync<ServiceClassType, ReturnType>(
    taskInformation: DispatchableTaskInformation<ServiceClassType, ReturnType>): Promise<ReturnType> {
    const taskId = this.uidGenerator.generate();

    // places the dispatcher IPC payload information to queue...
    this.ipcPayloadQueue.enqueue({
      flag: DispatcherIpcFlag.Dispatch,
      taskId: taskId,
      methodName: taskInformation.methodName,
      methodArguments: taskInformation.methodArguments,
      serviceName: taskInformation.serviceType.name,
      childProcessIndex: -1,
      result: ObjectUtilities.getEmptyObject(),
    });

    let response: undefined | DispatcherIpcPayload;

    // we want to wait until we receive response from the child process...
    await ThreadUtilities.waitAsync(async () => {
      response = this.childProcessResponseMap.get(taskId);

      // we shall stop waiting once we have the response...
      const shallCancel = ObjectUtilities.isObject(response);

      // returning true will break the wait... 
      return shallCancel;
    }, WAITING_THREAD_SLEEP_TIMEOUT_IN_MILLISECONDS);

    response = response!;

    if (response.flag === DispatcherIpcFlag.Error) {
      throw new DispatcherError(response.result);
    }

    return response.result;
  }

  private async onChildProcessResponseReceivedAsync(payload: DispatcherIpcPayload): Promise<void> {
    if (payload.flag === DispatcherIpcFlag.Available) {
      this.setChildProcessBusyStatusByIndex(false, payload.childProcessIndex);
    }
    else if (payload.flag === DispatcherIpcFlag.Dispatch) {
      this.decrementChildProcessTaskCountByIndex(payload.childProcessIndex);

      this.childProcessResponseMap.set(payload.taskId, payload);
    }
    else if (payload.flag === DispatcherIpcFlag.Error) {
      // if response does not contain task id...
      if (StringUtilities.isUndefinedOrNullOrEmpty(payload.taskId, true)) {
        console.log("An error occurred.", payload.result);

        return;
      }

      this.decrementChildProcessTaskCountByIndex(payload.childProcessIndex);

      this.childProcessResponseMap.set(payload.taskId, payload);
    }
  }

  private async onEventOccurredAsync(eventArguments: ChildProcessEventArguments): Promise<void> {
    // console.log('EVENT OCCURRED...', eventArguments);

    if (eventArguments.type === ChildProcessEventType.Spawn) {
      console.log(`Child process with index ${eventArguments.childProcessIndex} has spawned.`);
    } else if (eventArguments.type === ChildProcessEventType.DataReceive) {
      if (!ObjectUtilities.isObject(eventArguments.data)) { return; }

      const response = eventArguments.data as DispatcherIpcPayload;

      if (!NumberUtilities.isPositiveNumber(response.flag)) {
        console.log(`[Child Process ${eventArguments.childProcessIndex}]: Unknown payload flag ${response.flag}.`);

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
      this.childProcessesBusyStatus[i] = false;
      this.childProcessesTaskCount[i] = 0;
      const childProcess: IChildProcess = new ChildProcess({
        childProcessIndex: i,
        childProcessFileNameWithoutExtension: CHILD_PROCESS_FILE_NAME_WITHOUT_EXTENSION,
        dispatcherServiceInitializerPath: this.options.dispatcherServiceInitializerPath,
        dispatcherServiceInitializerClassName: this.options.dispatcherServiceInitializerClassName,
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

    // processes the IPC payload queue...
    // NOTE: WE SHALL NOT AWAIT BECAUSE WE WANT THIS
    // METHOD TO RUN ASYNCHRONOUSLY...
    this.processIpcPayloadQueueAsync();
  }

  private async processIpcPayloadQueueAsync(): Promise<void> {
    if (!this._isStarted) {
      clearInterval(this.interval);

      return;
    }

    // if there is no more IPC payloads in the queue, we shall return...
    if (this.ipcPayloadQueue.isEmpty()) { return; }

    // otherwise, we have one or more IPC payloads to process...
    // so, we shall try to get the next available child process...
    const childProcess = await this.getNextAvailableChildProcessAsync();

    // if no process is available, we shall return...
    if (!ObjectUtilities.isObject(childProcess)) { return; }

    // now we shall retrieve the next available IPC payload in queue...
    const ipcPayload = this.ipcPayloadQueue.dequeue();

    // if IPC payload is not an object (which is very very unlikely)...
    if (!ObjectUtilities.isObject(ipcPayload)) {
      // we must set the child process busy status...
      this.setChildProcessBusyStatusByIndex(false, childProcess!.getChildProcessIndex());
      this.decrementChildProcessTaskCountByIndex(childProcess!.getChildProcessIndex());

      // and return...
      return;
    }

    // we'll send the internal task information to the child process...
    const isSent = await childProcess!.sendAsync(ipcPayload!);

    if (isSent) { return; }

    this.setChildProcessBusyStatusByIndex(false, childProcess!.getChildProcessIndex());
    this.decrementChildProcessTaskCountByIndex(childProcess!.getChildProcessIndex());

    console.warn(`An error occurred while communicating to child process with index ${childProcess!.getChildProcessIndex()}.`);

    this.childProcessResponseMap.set(ipcPayload!.taskId, {
      flag: DispatcherIpcFlag.Error,
      taskId: ipcPayload!.taskId,
      result: ObjectUtilities.clone({
        data: new Error(`An error occurred while communicating to child process with index ${childProcess!.getChildProcessIndex()}.`),
      }),
      childProcessIndex: childProcess!.getChildProcessIndex(),
      methodName: ipcPayload!.methodName,
      serviceName: ipcPayload!.serviceName,
      methodArguments: ipcPayload!.methodArguments,
    });
  }

  public async stopAsync(): Promise<void> {
    this._isStarted = false;
  }

  public static createInstance(options: DispatcherOptions): IDispatcher {
    const dispatcher = new Dispatcher(options);

    return dispatcher;
  }
}
