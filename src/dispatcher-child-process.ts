import { IQueue, Queue, } from "@shahadul-17/collections";
import { ServiceProvider, } from "@shahadul-17/service-provider";
import { ArgumentsParser, NumberUtilities, ObjectUtilities, StringUtilities, ThreadUtilities } from "@shahadul-17/utilities";
import { IDispatcherServiceInitializer } from "./dispatcher-service-initializer.i";
import { DispatcherIpcPayload } from "./dispatcher-ipc-payload.t";
import { DispatcherIpcFlag } from "./dispatcher-ipc-flag.e";
import { IChildProcess, ChildProcess, ChildProcessEventType, ChildProcessEventArguments } from "./child-process";

const QUEUE_INITIAL_CAPACITY = 4096;

export class DispatcherChildProcess {

  private childProcess: IChildProcess = new ChildProcess({
    childProcessIndex: -1,
    childProcessFileNameWithoutExtension: StringUtilities.getEmptyString(),
  });

  private dispatcherServiceInitializerPath: string = StringUtilities.getEmptyString();
  private dispatcherServiceInitializerClassName: string = StringUtilities.getEmptyString();

  private readonly taskQueue: IQueue<any> = new Queue<any>(QUEUE_INITIAL_CAPACITY);
  private readonly serviceProvider = ServiceProvider.getInstance();

  constructor() {
    // binding methods to current instance...
    this.startAsync = this.startAsync.bind(this);
    this.onEventOccurredAsync = this.onEventOccurredAsync.bind(this);
    this.onSpawnedAsync = this.onSpawnedAsync.bind(this);
    this.onParentProcessRequestReceivedAsync = this.onParentProcessRequestReceivedAsync.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
    this.sendErrorAsync = this.sendErrorAsync.bind(this);
    this.onParentProcessExitedAsync = this.onParentProcessExitedAsync.bind(this);
    this.onParentProcessClosedAsync = this.onParentProcessClosedAsync.bind(this);
  }

  public async startAsync(): Promise<void> {
    this.childProcess.addEventListener(ChildProcessEventType.Spawn, this.onEventOccurredAsync);
    this.childProcess.addEventListener(ChildProcessEventType.DataReceive, this.onEventOccurredAsync);

    await this.childProcess.spawnAsync();
  }

  private async onEventOccurredAsync(eventArguments: ChildProcessEventArguments): Promise<void> {
    if (eventArguments.type === ChildProcessEventType.Spawn) {
      await this.onSpawnedAsync(eventArguments);
    }
    else if (eventArguments.type === ChildProcessEventType.DataReceive) {
      if (!ObjectUtilities.isObject(eventArguments.data)) { return; }

      const request = eventArguments.data as DispatcherIpcPayload;

      if (!NumberUtilities.isPositiveNumber(request.flag)) { return; }

      await this.onParentProcessRequestReceivedAsync(request);
    }
  }

  private async onSpawnedAsync(eventArguments: ChildProcessEventArguments): Promise<void> {
    try {
      this.dispatcherServiceInitializerPath = ArgumentsParser.getArgument("dispatcherServiceInitializerPath");
      this.dispatcherServiceInitializerClassName = ArgumentsParser.getArgument("dispatcherServiceInitializerClassName");

      this.dispatcherServiceInitializerClassName = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
        this.dispatcherServiceInitializerClassName, StringUtilities.getEmptyString(), true);
      let dispatcherServiceInitializerClass = require(this.dispatcherServiceInitializerPath);

      if (!StringUtilities.isEmpty(this.dispatcherServiceInitializerClassName)) {
        dispatcherServiceInitializerClass = dispatcherServiceInitializerClass[this.dispatcherServiceInitializerClassName];
      }

      const dispatcherServiceInitializer = new dispatcherServiceInitializerClass() as IDispatcherServiceInitializer;
      await dispatcherServiceInitializer.initializeAsync(this.serviceProvider);
    } catch (error) {
      await this.sendErrorAsync(error as Error);
    }
  }

  private async onParentProcessRequestReceivedAsync(request: DispatcherIpcPayload): Promise<void> {
    if (request.flag === DispatcherIpcFlag.Dispatch) {
      try {
        const service: any = this.serviceProvider.getByName(request.serviceName);
        const method = service[request.methodName] as Function;
        const methodArguments = Array.isArray(request.methodArguments)
          ? request.methodArguments : [];
        const result = await method.call(service, ...methodArguments);

        await this.sendAsync({
          flag: DispatcherIpcFlag.Dispatch,
          taskId: request.taskId,
          childProcessIndex: this.childProcess.getChildProcessIndex(),
          result: result,
          methodName: StringUtilities.getEmptyString(),
          serviceName: StringUtilities.getEmptyString(),
          methodArguments: undefined,
        });
      } catch (error) {
        await this.sendErrorAsync(error as Error, request.taskId);
      }
    }
  }

  private async sendAsync(response: DispatcherIpcPayload): Promise<boolean> {
    let isSent = false;

    try {
      isSent = await this.childProcess.sendAsync(response);
    } catch (error) {
      await this.sendErrorAsync(error as Error, response.taskId);
    }

    return isSent;
  }

  private async sendErrorAsync(error: Error, taskId?: string): Promise<boolean> {
    const sanitizedError = ObjectUtilities.sanitize({
      data: error,
      shallDeepSanitize: true,
    });
    const response: DispatcherIpcPayload = {
      flag: DispatcherIpcFlag.Error,
      childProcessIndex: this.childProcess.getChildProcessIndex(),
      result: sanitizedError,
      taskId: StringUtilities.isString(taskId)
        ? taskId! : StringUtilities.getEmptyString(),
      methodName: StringUtilities.getEmptyString(),
      serviceName: StringUtilities.getEmptyString(),
      methodArguments: undefined,
    };
    const isSent = await this.sendAsync(response);

    return isSent;
  }

  private async onParentProcessExitedAsync(code: number | null,
    signal: NodeJS.Signals | null): Promise<void> { }

  private async onParentProcessClosedAsync(code: number | null,
    signal: NodeJS.Signals | null): Promise<void> { }
}

const dispatcherChildProcess = new DispatcherChildProcess();
dispatcherChildProcess.startAsync();

// we shall keep waiting to...
ThreadUtilities.waitAsync();
