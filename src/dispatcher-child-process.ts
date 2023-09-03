import { NumberUtilities, ObjectUtilities, StringUtilities, ThreadUtilities } from "@shahadul-17/utilities";
import { IProcess, IProcessEventArguments, Process, ProcessEventType } from "./process";
import { IServiceProvider, ServiceProvider } from "@shahadul-17/service-provider";
import { DispatcherIpcPayload } from "./dispatcher-ipc-payload.t";
import { DispatcherIpcPayloadFlag } from "./dispatcher-ipc-payload-flag.e";
import { IDispatcherServiceInitializer } from "./dispatcher-service-initializer.i";

export class DispatcherChildProcess {

  private isDispatcherServiceInitializerInitialized: boolean = false;
  private readonly process: IProcess;
  private readonly serviceProvider: IServiceProvider;

  constructor() {
    this.process = new Process();
    this.serviceProvider = ServiceProvider.getInstance();

    // binding methods to current instance...
    this.initializeDispatcherServiceInitializerIfNotInitializedAsync
      = this.initializeDispatcherServiceInitializerIfNotInitializedAsync.bind(this);
    this.onRequestReceivedAsync = this.onRequestReceivedAsync.bind(this);
    this.startAsync = this.startAsync.bind(this);
    this.onEventOccurredAsync = this.onEventOccurredAsync.bind(this);
    this.onSpawnedAsync = this.onSpawnedAsync.bind(this);
    this.logAsync = this.logAsync.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
    this.sendErrorAsync = this.sendErrorAsync.bind(this);
  }

  private async initializeDispatcherServiceInitializerIfNotInitializedAsync(): Promise<void> {
    // we won't re-initialize if already initialized...
    if (this.isDispatcherServiceInitializerInitialized) { return; }

    this.isDispatcherServiceInitializerInitialized = true;

    try {
      let serviceInitializerClass = require(this.process.options.commandLineArguments!.serviceInitializerPath!);
      const serviceInitializerClassName = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
        this.process.options.commandLineArguments!.serviceInitializerClassName!, StringUtilities.getEmptyString(), true);

      if (!StringUtilities.isEmpty(serviceInitializerClassName)) {
        serviceInitializerClass = serviceInitializerClass[serviceInitializerClassName];
      }

      const dispatcherServiceInitializer = new serviceInitializerClass() as IDispatcherServiceInitializer;
      await dispatcherServiceInitializer.initializeAsync(this.serviceProvider);
    } catch (error) {
      this.isDispatcherServiceInitializerInitialized = false;

      throw error;
    }
  }

  private async onRequestReceivedAsync(payload: DispatcherIpcPayload): Promise<void> {
    if (payload.flag !== DispatcherIpcPayloadFlag.Dispatch) { return; }

    try {
      await this.initializeDispatcherServiceInitializerIfNotInitializedAsync();

      const service: any = this.serviceProvider.getByName(payload.serviceName!, payload.serviceScopeName);
      const method = service[payload.methodName!];

      if (typeof method !== "function") {
        throw new Error(`Requested method, '${payload.methodName}' does not belong to the service, '${payload.serviceName}'.`);
      }

      const methodArguments = Array.isArray(payload.methodArguments)
        ? payload.methodArguments : [];
      let result: any = method.call(service, ...methodArguments);

      if (result instanceof Promise) { result = await result; }

      await this.sendAsync({
        flag: DispatcherIpcPayloadFlag.Dispatch,
        payloadId: payload.payloadId,
        processId: this.process.processId!,
        result: result,
        methodName: payload.methodName,
        serviceName: payload.serviceName,
        methodArguments: methodArguments,
      });
    } catch (error) {
      await this.sendErrorAsync(error as Error, payload.payloadId);
    }
  }

  private async onSpawnedAsync(eventArguments: IProcessEventArguments): Promise<void> {
    await this.logAsync(`Child process with ID '${this.process.processId}' has spawned.`);
  }

  private async onEventOccurredAsync(eventArguments: IProcessEventArguments): Promise<void> {
    if (eventArguments.type === ProcessEventType.Spawn) {
      await this.onSpawnedAsync(eventArguments);
    } else if (eventArguments.type === ProcessEventType.DataReceive) {
      if (!ObjectUtilities.isObject(eventArguments.data)) { return; }

      const payload = eventArguments.data as DispatcherIpcPayload;

      if (!NumberUtilities.isPositiveNumber(payload.flag)) { return; }

      await this.onRequestReceivedAsync(payload);
    }
  }

  public async startAsync(): Promise<void> {
    this.process.addEventListener(ProcessEventType.Spawn, this.onEventOccurredAsync);
    this.process.addEventListener(ProcessEventType.DataReceive, this.onEventOccurredAsync);

    await this.process.spawnAsync();

    global.console.log = this.logAsync;
  }

  private logAsync(...parameters: Array<any>): Promise<boolean> {
    return this.sendAsync({
      flag: DispatcherIpcPayloadFlag.Log,
      processId: this.process.processId,
      result: parameters,
    });
  }

  private async sendAsync(payload: DispatcherIpcPayload): Promise<boolean> {
    let isSent = false;

    try {
      isSent = await this.process.sendAsync(payload);
    } catch (error) {
      await this.sendErrorAsync(error as Error, payload.payloadId);
    }

    return isSent;
  }

  private async sendErrorAsync(error: Error, payloadId?: string): Promise<boolean> {
    const sanitizedError = ObjectUtilities.sanitize({
      data: error,
      shallDeepSanitize: true,
    });
    const payload: DispatcherIpcPayload = {
      flag: DispatcherIpcPayloadFlag.Error,
      processId: this.process.processId,
      result: sanitizedError,
      payloadId: payloadId,
    };
    const isSent = await this.sendAsync(payload);

    return isSent;
  }
}

const dispatcherChildProcess = new DispatcherChildProcess();
dispatcherChildProcess.startAsync();

// we shall keep waiting to make sure that this child process does not exit...
ThreadUtilities.waitAsync();
