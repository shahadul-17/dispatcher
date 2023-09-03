import { FileUtilities, NumberUtilities, ObjectUtilities, StringUtilities } from "@shahadul-17/utilities";
import { UIDGenerator } from "@shahadul-17/uid-generator";
import { DispatcherIpcPayload } from "./dispatcher-ipc-payload.t";
import { DispatcherIpcPayloadFlag } from "./dispatcher-ipc-payload-flag.e";
import { DispatchableTaskInformation } from "./dispatchable-task-information.t";
import { DispatcherOptions } from "./dispatcher-options.t";
import { IDispatcher } from "./dispatcher.i";
import { IProcess, IProcessEventArguments, Process, ProcessEventType } from "./process";
import { ServiceType } from "@shahadul-17/service-provider";
import { ILogger, Logger, LogLevel } from "@shahadul-17/logger";

const CHILD_PROCESS_FILE_NAME_WITHOUT_EXTENSION = "dispatcher-child-process";

export class Dispatcher implements IDispatcher {

  private isStarting: boolean = false;
  private _isStarted: boolean = false;
  private readonly logger: ILogger<Dispatcher> = new Logger<Dispatcher>(Dispatcher.name);
  private readonly _options: DispatcherOptions;
  private readonly uidGenerator = UIDGenerator.create();
  private readonly processes: Array<IProcess>;

  private constructor(options: DispatcherOptions) {
    this._options = options;
    this.options.serviceInitializerPath = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
      this.options.serviceInitializerPath, StringUtilities.getEmptyString(), true);

    if (!FileUtilities.exists('file', this.options.serviceInitializerPath)) {
      throw new Error("Invalid service initializer path provided.");
    }

    if (!NumberUtilities.isPositiveNumber(this.options.processCount)) {
      this.options.processCount = 1;
    }

    this.processes = new Array<IProcess>(this.options.processCount);

    // binding methods...
    this.log = this.log.bind(this);
    this.getLeastBusyProcess = this.getLeastBusyProcess.bind(this);
    this.onChildProcessLogReceivedAsync = this.onChildProcessLogReceivedAsync.bind(this);
    this.onChildProcessResponseReceivedAsync = this.onChildProcessResponseReceivedAsync.bind(this);
    this.onEventOccurredAsync = this.onEventOccurredAsync.bind(this);
    this.dispatchAsync = this.dispatchAsync.bind(this);
    this.get = this.get.bind(this);
    this.startAsync = this.startAsync.bind(this);
    this.stopAsync = this.stopAsync.bind(this);
  }

  public get isStarted(): boolean {
    return this._isStarted;
  }

  public get processCount(): number {
    return this.options.processCount;
  }

  public get options(): DispatcherOptions {
    return this._options;
  }

  private log(logLevel: LogLevel, ...parameters: Array<any>): void {
    this.logger.log(logLevel, ...parameters);
  }

  private getLeastBusyProcess(): IProcess {
    let leastBusyProcess: IProcess = this.processes[0];

    // we shall iterate over all the processes...
    for (let i = 1; i < this.processes.length; ++i) {
      const process = this.processes[i];

      // if the task count of the process is greater than
      // or equal to our current least busy process's task count,
      // we shall skip this iteration...
      if (process.taskCount >= leastBusyProcess.taskCount) { continue; }

      // otherwise, we shall assign the process as our least busy process...
      leastBusyProcess = process;
    }

    // we must increment the process's task count by 1...
    leastBusyProcess.incrementTaskCount();

    return leastBusyProcess;
  }

  public dispatchAsync<ServiceClassType, ReturnType>(
    taskInformation: DispatchableTaskInformation<ServiceClassType, ReturnType>): Promise<ReturnType> {
    return new Promise<ReturnType>(async (resolve, reject) => {
      if (!this.isStarted) {
        return reject(new Error("Dispatcher is not started yet."));
      }

      if (typeof taskInformation.serviceType !== "function") {
        return reject(new Error("No service provided."));
      }

      taskInformation.methodName = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
        taskInformation.methodName, StringUtilities.getEmptyString(), true);

      if (StringUtilities.isEmpty(taskInformation.methodName)) {
        return reject(new Error("Service method name not provided."));
      }

      // first we shall generate a unique payload ID...
      const payloadId = this.uidGenerator.generate();
      // we shall retrieve the least busy process...
      const process = this.getLeastBusyProcess();
      // then we shall prepare the payload to be sent to the process...
      const payload: DispatcherIpcPayload = {
        flag: DispatcherIpcPayloadFlag.Dispatch,
        payloadId: payloadId,
        methodName: taskInformation.methodName!,
        methodArguments: taskInformation.methodArguments,
        serviceName: taskInformation.serviceType.name,
        serviceScopeName: taskInformation.serviceScopeName,
        processId: process.processId!,
      };
      const dataReceiveCallbackFunctionName = `onResponseReceivedAsync_${payloadId}_${process.processId}`;
      // NOTE: THIS OBJECT IS USED SO THAT WE CAN GENERATE UNIQUE FUNCTION NAMES.
      // THIS WILL BE USED WHILE REMOVING THE FUNCTION FROM THE EVENT LISTENERS...
      const callbackFunctionContainer: Record<string, any> = {
        // this function gets executed when data is received from the process...
        [dataReceiveCallbackFunctionName]: async function (
          eventArguments: IProcessEventArguments): Promise<void> {
          // if the event arguments do not contain data, we'll not proceed any further...
          if (!ObjectUtilities.isObject(eventArguments.data)) { return; }

          const payload = eventArguments.data as DispatcherIpcPayload;

          // if the payload ID does not match our generated payload ID, we'll not proceed any further...
          if (payload.payloadId !== payloadId) { return; }

          // now, we can safely remove the event listener...
          process.removeEventListener(callbackFunctionContainer[dataReceiveCallbackFunctionName],
            ProcessEventType.DataReceive);

          if (payload.flag === DispatcherIpcPayloadFlag.Dispatch) {
            // we'll decrement the process's task count...
            process.decrementTaskCount();

            return resolve(payload.result);
          } else if (payload.flag === DispatcherIpcPayloadFlag.Error) {
            // we'll decrement the process's task count...
            process.decrementTaskCount();

            if (!ObjectUtilities.isObject(payload.result)) {
              return reject(new Error("An unexpected error occurred while executing the service method."));
            }

            const message = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
              payload.result.message, "An unexpected error occurred while executing the service method.", true);
            const stack = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
              payload.result.stack, StringUtilities.getEmptyString(), true);
            const error = new Error(message);

            if (!StringUtilities.isEmpty(stack)) {
              error.stack = stack;
            }

            return reject(error);
          }
        },
      };

      // before sending payload to the process, we must first add a listener to the data receive event of the process...
      process.addEventListener(ProcessEventType.DataReceive, callbackFunctionContainer[dataReceiveCallbackFunctionName]);

      // now we'll send the payload to the process...
      await process.sendAsync(payload);
    });
  }

  public get<Type>(serviceType: ServiceType<Type>, scopeName?: string): Type {
    const context = this;
    const serviceProxy = new Proxy(ObjectUtilities.getEmptyObject(), {
      get(_, property) {
        return function (...args: Array<any>): Promise<any> {
          return context.dispatchAsync({
            serviceType: serviceType,
            serviceScopeName: scopeName,
            methodName: property as string,
            returnType: ObjectUtilities.getEmptyObject(),
            methodArguments: Array.isArray(args) ? args : undefined,
          });
        };
      },
    });

    return serviceProxy;
  }

  private async onChildProcessLogReceivedAsync(payload: DispatcherIpcPayload): Promise<void> {
    const { logLevel, parameters, } = payload.result;

    this.log(logLevel, `[Process ${payload.processId}]`, ...parameters);
  }

  private async onChildProcessResponseReceivedAsync(payload: DispatcherIpcPayload): Promise<void> { }

  private async onEventOccurredAsync(eventArguments: IProcessEventArguments): Promise<void> {
    if (eventArguments.type === ProcessEventType.DataReceive) {
      if (!ObjectUtilities.isObject(eventArguments.data)) { return; }

      const payload = eventArguments.data as DispatcherIpcPayload;

      if (payload.flag === DispatcherIpcPayloadFlag.Log) {
        await this.onChildProcessLogReceivedAsync(payload);
      } else if (payload.flag === DispatcherIpcPayloadFlag.Dispatch) {
        await this.onChildProcessResponseReceivedAsync(payload);
      } else if (payload.flag === DispatcherIpcPayloadFlag.Error) {
        // if the payload does not contain an ID...
        if (StringUtilities.isUndefinedOrNullOrEmpty(payload.payloadId, true)) {
          this.log(LogLevel.Error, `[Process ${eventArguments.processId}]: The following error occurred.`, payload.result);
        }
      }
    } else if (eventArguments.type === ProcessEventType.Error) {
      this.log(LogLevel.Error, `[Process ${eventArguments.processId}]: The following error occurred.`, eventArguments.error);
    }
  }

  public async startAsync(): Promise<void> {
    if (this.isStarting) { return; }

    this.isStarting = true;

    const processEventTypes = [
      ProcessEventType.Spawn,
      ProcessEventType.Disconnect,
      ProcessEventType.DataReceive,
      ProcessEventType.Error,
      ProcessEventType.Exit,
      ProcessEventType.Close,
    ];
    const promises: Array<Promise<IProcess>> = new Array(this.options.processCount);

    for (let i = 0; i < promises.length; ++i) {
      const process: IProcess = new Process({
        processId: i,
        processFileNameWithoutExtension: CHILD_PROCESS_FILE_NAME_WITHOUT_EXTENSION,
        commandLineArguments: {
          serviceInitializerPath: this.options.serviceInitializerPath,
          serviceInitializerClassName: this.options.serviceInitializerClassName,
        },
      });

      for (const processEventType of processEventTypes) {
        process.addEventListener(processEventType, this.onEventOccurredAsync);
      }

      promises[i] = process.spawnAsync();
    }

    let processes: Array<IProcess>;

    try {
      processes = await Promise.all(promises);
    } catch (error) {
      this.isStarting = false;

      throw error;
    }

    for (let i = 0; i < processes.length; ++i) {
      this.processes[i] = processes[i];
    }

    this._isStarted = true;
  }

  public async stopAsync(): Promise<void> {
    this._isStarted = false;
  }

  public static createInstance(options: DispatcherOptions): IDispatcher {
    const dispatcher = new Dispatcher(options);

    return dispatcher;
  }
}
