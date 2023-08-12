import { ChildProcessWithoutNullStreams, SendHandle, Serializable, spawn } from "child_process";
import { FileUtilities, JsonSerializer, ObjectUtilities, ThreadUtilities } from "@shahadul-17/utilities";
import { UIDGenerator } from "@shahadul-17/uid-generator";
import { IMap, Map } from "@shahadul-17/collections";
import { DispatcherOptions } from "./dispatcher-options.t";
import { IDispatcher } from "./dispatcher.i";
import { DispatchableTaskInformation } from "./dispatchable-task-information.t";
import { InternalDispatchableTaskInformation } from "./internal-dispatchable-task-information.t";

export class Dispatcher implements IDispatcher {

  private _isStarted: boolean = false;
  private childProcessIndex: number = 0;
  private readonly options: DispatcherOptions;
  private readonly uidGenerator = UIDGenerator.create();
  private readonly childProcesses: Array<ChildProcessWithoutNullStreams>;
  private readonly childProcessResponseMap: IMap<string, any> = new Map<string, any>();

  private constructor(options: DispatcherOptions) {
    this.options = options;
    this.childProcesses = new Array<ChildProcessWithoutNullStreams>(options.processCount);

    // binding methods to current instance...
    this.startAsync = this.startAsync.bind(this);
    this.spawnChildProcessAsync = this.spawnChildProcessAsync.bind(this);
    this.onChildProcessStandardOutputDataReceivedAsync = this.onChildProcessStandardOutputDataReceivedAsync.bind(this);
    this.onChildProcessStandardErrorDataReceivedAsync = this.onChildProcessStandardErrorDataReceivedAsync.bind(this);
    this.onChildProcessSpawnedAsync = this.onChildProcessSpawnedAsync.bind(this);
    this.onChildProcessExitedAsync = this.onChildProcessExitedAsync.bind(this);
    this.onChildProcessClosedAsync = this.onChildProcessClosedAsync.bind(this);
    this.onChildProcessDisconnectedAsync = this.onChildProcessDisconnectedAsync.bind(this);
  }

  public isStarted(): boolean {
    return this._isStarted;
  }

  public getThreadCount(): number {
    return 0;
  }

  public async dispatchAsync(taskInformation: DispatchableTaskInformation): Promise<any> {
    const childProcess = this.childProcesses[this.childProcessIndex];

    this.childProcessIndex++;

    if (this.childProcessIndex >= this.childProcesses.length) {
      this.childProcessIndex = 0;
    }

    const taskId = this.uidGenerator.generate();

    // we'll send the internal task information to the child process...
    childProcess.stdin.write(JsonSerializer.serialize({
      flag: "DISPATCH",
      taskId: taskId,
      methodName: taskInformation.methodName,
      methodArguments: taskInformation.methodArguments,
      serviceName: taskInformation.serviceType.name,
    }));

    let response: any;

    // we want to wait until we receive response from the child process...
    await ThreadUtilities.waitAsync(async () => {
      response = this.childProcessResponseMap.get(taskId);
      // we shall stop waiting once we have the response...
      const shallCancel = ObjectUtilities.isObject(response);

      // returning true will break the wait... 
      return shallCancel;
    });

    return response.result;
  }

  public async startAsync(): Promise<void> {
    if (this._isStarted) { return; }

    this._isStarted = true;

    for (let i = 0; i < this.options.processCount; ++i) {
      this.childProcesses[i] = await this.spawnChildProcessAsync(i);
    }
  }

  async stopAsync(): Promise<void> {
    this._isStarted = false;
  }

  private async onChildProcessStandardOutputDataReceivedAsync(data: Buffer,
    childProcessIndex: number, childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    let response;

    try {
      response = JsonSerializer.deserialize<any>(data.toString("utf-8"));
    } catch { return; }

    if (response.flag === "INITIAL_INFORMATION_RESPONSE") { return; }
    else if (response.flag === "DISPATCH_RESPONSE") {
      this.childProcessResponseMap.set(response.taskId, response);
    }
  }

  private async onChildProcessStandardErrorDataReceivedAsync(data: Buffer,
    childProcessIndex: number, childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    console.log("DATA RECEIVED 222", data.toString("utf-8"));
  }

  private async onChildProcessSpawnedAsync(childProcessIndex: number,
    childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    console.log(`Process ${childProcessIndex} spawned...`);
    // when the process is spawned, we shall send some
    // basic information to the child process...
    childProcess.stdin.write(JsonSerializer.serialize({
      flag: "INITIAL_INFORMATION",
      childProcessIndex: childProcessIndex,
      dispatcherServiceInitializerPath: this.options.dispatcherServiceInitializerPath,
      dispatcherServiceInitializerClassName: this.options.dispatcherServiceInitializerClassName,
    }));
  }

  private async onChildProcessExitedAsync(code: number | null, signal: NodeJS.Signals | null,
    childProcessIndex: number, childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    console.log(`Process ${childProcessIndex} exited...`);
  }

  private async onChildProcessClosedAsync(code: number | null, signal: NodeJS.Signals | null,
    childProcessIndex: number, childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    console.log(`Process ${childProcessIndex} closed...`);
  }

  private async onChildProcessDisconnectedAsync(childProcessIndex: number,
    childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    console.log(`Process ${childProcessIndex} disconnected...`);
  }

  private async spawnChildProcessAsync(childProcessIndex: number): Promise<ChildProcessWithoutNullStreams> {
    const childProcessFilePath = Dispatcher.toChildProcessFilePath("dispatcher-child-process");
    const childProcess = spawn("node", [childProcessFilePath, "--isChildProcess", "true"], {
      shell: true,
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
      },
    });

    // childProcess.on("message", (message, sendHandle) => this.onChildProcessMessageReceivedAsync(message, sendHandle, childProcessIndex, childProcess));
    childProcess.stdout.on("data", data => this.onChildProcessStandardOutputDataReceivedAsync(data, childProcessIndex, childProcess));
    childProcess.stderr.on("data", data => this.onChildProcessStandardErrorDataReceivedAsync(data, childProcessIndex, childProcess));
    childProcess.on("spawn", () => this.onChildProcessSpawnedAsync(childProcessIndex, childProcess));
    childProcess.on("exit", (code, signal) => this.onChildProcessExitedAsync(code, signal, childProcessIndex, childProcess));
    childProcess.on("close", (code, signal) => this.onChildProcessClosedAsync(code, signal, childProcessIndex, childProcess));
    childProcess.on("disconnect", () => this.onChildProcessDisconnectedAsync(childProcessIndex, childProcess));

    return childProcess;
  }

  private static toChildProcessFilePath(fileNameWithoutExtension: string): string {
    const currentFilePath = FileUtilities.toAbsolutePath(__filename);
    const currentDirectoryPath = FileUtilities.extractDirectoryPath(currentFilePath);
    const dispatcherChildProcessFilePath = FileUtilities.join(currentDirectoryPath, `${fileNameWithoutExtension}.js`);

    // we must enclose the file path with double quotes because the path might contain spaces...
    return `"${dispatcherChildProcessFilePath}"`;
  }

  public static createInstance(options: DispatcherOptions): IDispatcher {
    const dispatcher = new Dispatcher(options);

    return dispatcher;
  }
}
