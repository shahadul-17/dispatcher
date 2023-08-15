import { ChildProcessWithoutNullStreams, spawn, } from "child_process";
import {
  FileUtilities, JsonSerializer, ArgumentsParser, StringUtilities,
  ObjectUtilities, IStreamReader, StreamReader,
} from "@shahadul-17/utilities";
import { EventManager, } from "@shahadul-17/event-manager";
import { IChildProcess } from "./child-process.i";
import { ChildProcessOptions } from "./child-process-options.t";
import { ChildProcessEventType } from "./child-process-event-type.e";
import { ChildProcessEventArguments } from "./child-process-event-args";

const STREAM_READER_LINE_DELIMITER = "<--- END OF LINE --->";

export class ChildProcess extends EventManager<ChildProcessEventType, ChildProcessEventArguments> implements IChildProcess {

  private readonly _isChildProcess: boolean;
  private readonly options: ChildProcessOptions;
  private streamReader: IStreamReader = new StreamReader();
  private childProcess: undefined | ChildProcessWithoutNullStreams;

  constructor(options: ChildProcessOptions) {
    super();

    this.options = options;
    this._isChildProcess = ArgumentsParser.getArgument("isChildProcess") === "true";
    this.streamReader.setLineDelimiter(STREAM_READER_LINE_DELIMITER);

    // binding methods...
    this.isChildProcess = this.isChildProcess.bind(this);
    this.getOptions = this.getOptions.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
    this.spawnAsync = this.spawnAsync.bind(this);
    this.onDataReceivedAsync = this.onDataReceivedAsync.bind(this);

    // if current process is child process...
    if (this.isChildProcess()) {
      this.options.childProcessIndex = parseInt(ArgumentsParser.getArgument("childProcessIndex"));
    }
  }

  getChildProcessIndex(): number {
    return this.options.childProcessIndex;
  }

  public isChildProcess(): boolean {
    return this._isChildProcess;
  }

  public getOptions(): ChildProcessOptions {
    return this.options;
  }

  public async sendAsync<Type>(data: Type): Promise<boolean> {
    let isSent = false;

    try {
      let dataAsJson = JsonSerializer.serialize(data, { shallDeepSanitize: true, });
      dataAsJson = `${dataAsJson}${STREAM_READER_LINE_DELIMITER}`;

      // if current process is the child process...
      if (this.isChildProcess()) {
        // we shall send data to the parent process...
        isSent = process.stdout.write(dataAsJson);
      }
      // otherwise if current process is the parent process and
      // the child process object is not undefined...
      else if (typeof this.childProcess !== "undefined") {
        // we shall send the data to the child process...
        isSent = this.childProcess.stdin.write(dataAsJson);
      }
      else {
        console.warn("Child process is not defined.");
      }
    } catch (error) {
      // if the process is a child process...
      if (this.isChildProcess()) {
        // we shall send the error to the parent...
        throw error;
      } else {
        // we shall just log the error in case of parent process...
        console.error("An error occurred while sending data to child process.", error);
      }
    }

    return isSent;
  }

  private spawnAsParentAsync(): Promise<IChildProcess> {
    return new Promise<IChildProcess>(async (resolve, reject) => {
      const childProcessFilePath = ChildProcess.toProcessFilePath(this.options.childProcessFileNameWithoutExtension);
      const childProcessArguments: Array<string> = [childProcessFilePath, "--isChildProcess", "true"];

      for (const [key, value] of Object.entries(this.options)) {
        childProcessArguments.push(`--${key}`);
        childProcessArguments.push(value);
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
          type: ChildProcessEventType.Spawn,
          // dataAsString: StringUtilities.getEmptyString(),
          // rawData: ObjectUtilities.getEmptyObject(),
          isErrorData: false,
          data: ObjectUtilities.getEmptyObject(),
          childProcessIndex: this.options.childProcessIndex,
        });

        resolve(this);
      });

      childProcess.on("disconnect", async () => {
        const error = new Error("Child process has disconnected.");
        const eventTypes = [
          ChildProcessEventType.Disconnect,
          ChildProcessEventType.Error
        ];

        for (const eventType of eventTypes) {
          this.dispatchEventListeners({
            type: eventType,
            // dataAsString: StringUtilities.getEmptyString(),
            // rawData: ObjectUtilities.getEmptyObject(),
            isErrorData: false,
            data: ObjectUtilities.getEmptyObject(),
            childProcessIndex: this.options.childProcessIndex,
            error: error,
          });
        }

        reject(error);
      });

      childProcess.on("exit", (code, signal) => () => {
        const error = new Error(`Child process has exited with code '${code ?? ''}' and signal '${signal ?? ''}'.`);
        const eventTypes = [
          ChildProcessEventType.Exit,
          ChildProcessEventType.Error
        ];

        for (const eventType of eventTypes) {
          this.dispatchEventListeners({
            type: eventType,
            // dataAsString: StringUtilities.getEmptyString(),
            // rawData: ObjectUtilities.getEmptyObject(),
            isErrorData: false,
            data: ObjectUtilities.getEmptyObject(),
            childProcessIndex: this.options.childProcessIndex,
            error: error,
            exitCode: code,
            exitSignal: signal,
          });
        }

        reject(error);
      });

      childProcess.on("close", (code, signal) => {
        const error = new Error(`Child process has closed with code '${code ?? ''}' and signal '${signal ?? ''}'.`);
        const eventTypes = [
          ChildProcessEventType.Close,
          ChildProcessEventType.Error
        ];

        for (const eventType of eventTypes) {
          this.dispatchEventListeners({
            type: eventType,
            // dataAsString: StringUtilities.getEmptyString(),
            // rawData: ObjectUtilities.getEmptyObject(),
            isErrorData: false,
            data: ObjectUtilities.getEmptyObject(),
            childProcessIndex: this.options.childProcessIndex,
            error: error,
            exitCode: code,
            exitSignal: signal,
          });
        }

        reject(error);
      });

      childProcess.on("error", async error => {
        this.dispatchEventListeners({
          type: ChildProcessEventType.Error,
          // dataAsString: StringUtilities.getEmptyString(),
          // rawData: ObjectUtilities.getEmptyObject(),
          isErrorData: false,
          data: ObjectUtilities.getEmptyObject(),
          childProcessIndex: this.options.childProcessIndex,
          error: error,
        });

        reject(error);
      });

      // adding data receive listeners...
      childProcess.stdout.on("data", chunk => this.onDataReceivedAsync(chunk));
      childProcess.stderr.on("data", chunk => this.onDataReceivedAsync(chunk, true));
    });
  }

  private spawnAsChildAsync(): Promise<IChildProcess> {
    return new Promise<IChildProcess>(async (resolve, reject) => {
      process.stdin.on("data", chunk => this.onDataReceivedAsync(chunk));
      // process.on("exit", this.onParentProcessExitedAsync);
      // process.on("close", this.onParentProcessClosedAsync);

      this.dispatchEventListeners({
        type: ChildProcessEventType.Spawn,
        // dataAsString: StringUtilities.getEmptyString(),
        // rawData: ObjectUtilities.getEmptyObject(),
        isErrorData: false,
        data: ObjectUtilities.getEmptyObject(),
        childProcessIndex: this.options.childProcessIndex,
      });

      resolve(this);
    });
  }

  public spawnAsync(): Promise<IChildProcess> {
    if (this.isChildProcess()) {
      return this.spawnAsChildAsync();
    }

    return this.spawnAsParentAsync();
  }

  private async onDataReceivedAsync(chunk: any, isErrorData = false): Promise<void> {
    this.streamReader.append(chunk);

    let data: any;

    while (ObjectUtilities.isObject(data = this.streamReader.readObject())) {
      // otherwise dispatch data receive event...
      this.dispatchEventListeners({
        type: ChildProcessEventType.DataReceive,
        // dataAsString: dataAsString!,
        // rawData: chunk,
        isErrorData: isErrorData,
        data: data,
        childProcessIndex: this.options.childProcessIndex,
      });
    }
  }

  private static toProcessFilePath(fileNameWithoutExtension: string): string {
    const currentFilePath = FileUtilities.toAbsolutePath(__filename);
    let currentDirectoryPath = FileUtilities.extractDirectoryPath(currentFilePath);
    // we want to go back by one directory...
    currentDirectoryPath = FileUtilities.extractDirectoryPath(currentDirectoryPath);
    const dispatcherChildProcessFilePath = FileUtilities.join(currentDirectoryPath, `${fileNameWithoutExtension}.js`);

    // we must enclose the file path with double quotes because the path might contain spaces...
    return `"${dispatcherChildProcessFilePath}"`;
  }
}
