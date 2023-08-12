import { IQueue, Queue, } from "@shahadul-17/collections";
import { ServiceProvider, } from "@shahadul-17/service-provider";
import { JsonSerializer, StringUtilities, ThreadUtilities } from "@shahadul-17/utilities";
import { SendHandle, Serializable } from "child_process";
import { IDispatcherServiceInitializer } from "./dispatcher-service-initializer.i";

const QUEUE_INITIAL_CAPACITY = 4096;

export class DispatcherChildProcess {

  private childProcessIndex: number = -1;
  private dispatcherServiceInitializerPath: string = StringUtilities.getEmptyString();
  private dispatcherServiceInitializerClassName: string = StringUtilities.getEmptyString();
  private readonly taskQueue: IQueue<any> = new Queue<any>(QUEUE_INITIAL_CAPACITY);
  private readonly serviceProvider = ServiceProvider.getInstance();

  constructor() {
    // binding methods to current instance...
    this.startAsync = this.startAsync.bind(this);
    this.onParentProcessMessageReceivedAsync = this.onParentProcessMessageReceivedAsync.bind(this);
    this.onParentProcessStandardOutputDataReceivedAsync = this.onParentProcessStandardOutputDataReceivedAsync.bind(this);
    this.onParentProcessStandardErrorDataReceivedAsync = this.onParentProcessStandardErrorDataReceivedAsync.bind(this);
    this.onParentProcessExitedAsync = this.onParentProcessExitedAsync.bind(this);
    this.onParentProcessClosedAsync = this.onParentProcessClosedAsync.bind(this);
    this.onParentProcessDisconnectedAsync = this.onParentProcessDisconnectedAsync.bind(this);
  }

  public async startAsync(): Promise<void> {
    process.stdin.on("data", this.onParentProcessStandardOutputDataReceivedAsync);
    // process.stdout.on("data", this.onParentProcessStandardOutputDataReceivedAsync);
    // process.stderr.on("data", this.onParentProcessStandardErrorDataReceivedAsync);
    // process.on("message", this.onParentProcessMessageReceivedAsync);
    process.on("exit", this.onParentProcessExitedAsync);
    process.on("close", this.onParentProcessClosedAsync);
  }

  private async onParentProcessMessageReceivedAsync(
    message: Serializable, sendHandle: SendHandle): Promise<void> {

  }

  private async onParentProcessStandardOutputDataReceivedAsync(data: Buffer): Promise<void> {
    let request;

    try {
      request = JsonSerializer.deserialize<any>(data.toString("utf-8"));
    } catch { return; }

    if (request.flag === "INITIAL_INFORMATION") {
      this.childProcessIndex = request.childProcessIndex;
      this.dispatcherServiceInitializerPath = request.dispatcherServiceInitializerPath;
      this.dispatcherServiceInitializerClassName = StringUtilities.getDefaultIfUndefinedOrNullOrEmpty(
        request.dispatcherServiceInitializerClassName, StringUtilities.getEmptyString(), true);

      let dispatcherServiceInitializerClass = require(this.dispatcherServiceInitializerPath);

      if (!StringUtilities.isEmpty(this.dispatcherServiceInitializerClassName)) {
        dispatcherServiceInitializerClass = dispatcherServiceInitializerClass[this.dispatcherServiceInitializerClassName];
      }

      const dispatcherServiceInitializer = new dispatcherServiceInitializerClass() as IDispatcherServiceInitializer;
      await dispatcherServiceInitializer.initializeAsync(this.serviceProvider);

      process.stdout.write(JsonSerializer.serialize({
        flag: "INITIAL_INFORMATION_RESPONSE",
        childProcessIndex: this.childProcessIndex,
      }));
    } else if (request.flag === "DISPATCH") {
      const service: any = this.serviceProvider.getByName(request.serviceName);
      const method = service[request.methodName] as Function;
      const methodArguments = Array.isArray(request.methodArguments)
        ? request.methodArguments : [];
      const result = method.call(service, ...methodArguments);

      process.stdout.write(JsonSerializer.serialize({
        flag: "DISPATCH_RESPONSE",
        taskId: request.taskId,
        childProcessIndex: this.childProcessIndex,
        result: result,
      }));
    }
  }

  private async onParentProcessStandardErrorDataReceivedAsync(data: Buffer): Promise<void> {
    // console.log(typeof data);
    // console.log("DATA RECEIVED 222", data.toString("utf-8"));
  }

  private async onParentProcessExitedAsync(code: number | null,
    signal: NodeJS.Signals | null): Promise<void> { }

  private async onParentProcessClosedAsync(code: number | null,
    signal: NodeJS.Signals | null): Promise<void> { }

  private async onParentProcessDisconnectedAsync(): Promise<void> { }
}

const dispatcherChildProcess = new DispatcherChildProcess();
dispatcherChildProcess.startAsync();

// we shall keep waiting to...
ThreadUtilities.waitAsync();
