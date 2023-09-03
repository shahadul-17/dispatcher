import { ChildProcessWithoutNullStreams, spawn, } from "child_process";
import { FileUtilities, IStreamReader, JsonSerializer, ObjectUtilities, StreamReader, StringUtilities, NumberUtilities, } from "@shahadul-17/utilities";
import { EventManager } from "@shahadul-17/event-manager";
import { ProcessOptions } from "./process-options.t";
import { ProcessEventType } from "./process-event-type.e";
import { IProcessEventArguments } from "./process-event-args.i";
import { IProcess } from "./process.i";

const END_OF_DATA_MARKER = "<--- END OF DATA --->";

/**
 * Parent process shall use this class to communicate with the child process.
 */
export class ChildProcess extends EventManager<ProcessEventType,
  IProcessEventArguments> implements IProcess {

  private _taskCount: number = 0;
  private readonly _options: ProcessOptions;
  private readonly streamReader: IStreamReader;
  private childProcess: undefined | ChildProcessWithoutNullStreams;

  constructor(options: ProcessOptions) {
    super();

    this._options = options;
    this.streamReader = new StreamReader();
    this.streamReader.setLineDelimiter(END_OF_DATA_MARKER);

    // binding methods...
    this.incrementTaskCount = this.incrementTaskCount.bind(this);
    this.decrementTaskCount = this.decrementTaskCount.bind(this);
    this.onDataReceivedAsync = this.onDataReceivedAsync.bind(this);
    this.spawnAsync = this.spawnAsync.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
  }

  public get isChildProcess(): boolean { return false; }

  public get taskCount(): number { return this._taskCount; }

  public get processId(): undefined | number { return this.options.processId; }

  public get options(): ProcessOptions { return this._options; }

  public incrementTaskCount(step?: number): number {
    // if the provided step is not a positive number...
    if (!NumberUtilities.isPositiveNumber(step)) {
      // we shall set the step to 1...
      step = 1;
    }

    this._taskCount = this._taskCount + step!;

    return this._taskCount;
  }

  public decrementTaskCount(step?: number): number {
    // if the provided step is not a positive number...
    if (!NumberUtilities.isPositiveNumber(step)) {
      // we shall set the step to 1...
      step = 1;
    }

    this._taskCount = this._taskCount - step!;

    // task count can never be less than zero...
    if (this._taskCount < 0) { this._taskCount = 0; }

    return this._taskCount;
  }

  private async onDataReceivedAsync(chunk: any): Promise<void> {
    this.streamReader.append(chunk);

    let data: any;

    while (ObjectUtilities.isObject(data = this.streamReader.readObject())) {
      // dispatches data receive event...
      this.dispatchEventListeners({
        type: ProcessEventType.DataReceive,
        data: data,
      });
    }
  }

  public spawnAsync(): Promise<IProcess> {
    return new Promise<IProcess>(async (resolve, reject) => {
      if (StringUtilities.isUndefinedOrNullOrEmpty(this.options.processFileNameWithoutExtension)) {
        return reject(new Error("Child process file name without extension is not provided."));
      }

      const childProcessFilePath = ChildProcess.toProcessFilePath(this.options.processFileNameWithoutExtension!);
      const commandLineArguments = ObjectUtilities.isObject(this.options.commandLineArguments)
        ? this.options.commandLineArguments!
        : ObjectUtilities.getEmptyObject();
      const childProcessArguments: Array<string> = [
        childProcessFilePath,
        "--isChildProcess", "true",
        "--processId", `${NumberUtilities.isNumber(this.processId) ? this.processId : -1}`,
      ];

      for (const [key, value] of Object.entries(commandLineArguments)) {
        childProcessArguments.push(`--${key}`);
        childProcessArguments.push(`"${value}"`);
      }

      const childProcess = spawn("node", childProcessArguments, {
        shell: true,
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
        },
      });

      childProcess.on("spawn", async () => {
        // assigning child process...
        this.childProcess = childProcess;

        this.dispatchEventListeners({
          type: ProcessEventType.Spawn,
          processId: this.processId,
        });

        resolve(this);
      });

      childProcess.on("disconnect", async () => {
        const error = new Error(`Child process with ID, '${this.processId}' has disconnected.`);
        const eventTypes = [
          ProcessEventType.Disconnect,
          ProcessEventType.Error,
        ];

        for (const eventType of eventTypes) {
          this.dispatchEventListeners({
            type: eventType,
            processId: this.processId,
            error: error,
          });
        }

        reject(error);
      });

      childProcess.on("exit", (code, signal) => () => {
        const error = new Error(`Child process with ID, '${this.processId}' has exited with code '${code ?? ''}' and signal '${signal ?? ''}'.`);
        const eventTypes = [
          ProcessEventType.Exit,
          ProcessEventType.Error,
        ];

        for (const eventType of eventTypes) {
          this.dispatchEventListeners({
            type: eventType,
            processId: this.processId,
            error: error,
            exitCode: NumberUtilities.isNumber(code) ? code! : undefined,
            exitSignal: StringUtilities.isString(signal) ? signal! : undefined,
          });
        }

        reject(error);
      });

      childProcess.on("close", (code, signal) => {
        const error = new Error(`Child process with ID, '${this.processId}' has closed with code '${code ?? ''}' and signal '${signal ?? ''}'.`);
        const eventTypes = [
          ProcessEventType.Close,
          ProcessEventType.Error,
        ];

        for (const eventType of eventTypes) {
          this.dispatchEventListeners({
            type: eventType,
            processId: this.processId,
            error: error,
            exitCode: NumberUtilities.isNumber(code) ? code! : undefined,
            exitSignal: StringUtilities.isString(signal) ? signal! : undefined,
          });
        }

        reject(error);
      });

      childProcess.on("error", async error => {
        this.dispatchEventListeners({
          type: ProcessEventType.Error,
          processId: this.processId,
          error: error,
        });

        reject(error);
      });

      // adding data receive listener...
      childProcess.stdout.setEncoding("utf-8");
      childProcess.stdout.on("data", chunk => this.onDataReceivedAsync(chunk));
    });
  }

  public async sendAsync<Type>(data: Type): Promise<boolean> {
    // if the underlying child process has not spawned yet,
    // we wouldn't be able to send data to the child process...
    if (typeof this.childProcess === "undefined") { return false; }

    // any error thrown by this method shall be sent to the parent...
    let dataAsJson = JsonSerializer.serialize(data, {
      shallDeepSanitize: true,
    });
    dataAsJson = `${dataAsJson}${END_OF_DATA_MARKER}\n`;     // <-- we must add the new-line character...

    // we shall send data to the child process...
    this.childProcess.stdin.cork();

    const isSent = this.childProcess.stdin.write(dataAsJson, "utf-8");

    this.childProcess.stdin.uncork();

    return isSent;
  }

  private static toProcessFilePath(processFileNameWithoutExtension: string): string {
    const currentFilePath = FileUtilities.toAbsolutePath(__filename);
    let currentDirectoryPath = FileUtilities.extractDirectoryPath(currentFilePath);
    // we want to go back by one directory...
    currentDirectoryPath = FileUtilities.extractDirectoryPath(currentDirectoryPath);
    const processFilePath = FileUtilities.join(currentDirectoryPath, `${processFileNameWithoutExtension}.js`);

    // we must enclose the file path with double quotes because the path might contain spaces...
    return `"${processFilePath}"`;
  }
}
