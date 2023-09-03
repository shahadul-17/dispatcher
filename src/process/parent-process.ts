import { ArgumentsParser, IStreamReader, JsonSerializer, NumberUtilities, ObjectUtilities, StreamReader, } from "@shahadul-17/utilities";
import { EventManager } from "@shahadul-17/event-manager";
import { ProcessOptions } from "./process-options.t";
import { ProcessEventType } from "./process-event-type.e";
import { IProcessEventArguments } from "./process-event-args.i";
import { IProcess } from "./process.i";

const END_OF_DATA_MARKER = "<--- END OF DATA --->";

/**
 * Child processes shall use this class to communicate with the parent process.
 */
export class ParentProcess extends EventManager<ProcessEventType,
  IProcessEventArguments> implements IProcess {

  private _taskCount: number = 0;
  private readonly _options: ProcessOptions;
  private readonly streamReader: IStreamReader;

  constructor(options: ProcessOptions) {
    super();

    this._options = options;
    this._options.commandLineArguments = ArgumentsParser.toObject();
    this._options.processId = parseInt(this._options.commandLineArguments.processId!);
    this.streamReader = new StreamReader();
    this.streamReader.setLineDelimiter(END_OF_DATA_MARKER);

    // binding methods...
    this.incrementTaskCount = this.incrementTaskCount.bind(this);
    this.decrementTaskCount = this.decrementTaskCount.bind(this);
    this.onDataReceivedAsync = this.onDataReceivedAsync.bind(this);
    this.spawnAsync = this.spawnAsync.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
  }

  public get isChildProcess(): boolean { return true; }

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
    return new Promise<IProcess>(async resolve => {
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", chunk => this.onDataReceivedAsync(chunk));

      this.dispatchEventListeners({
        type: ProcessEventType.Spawn,
        processId: this.processId,
      });

      resolve(this);
    });
  }

  public async sendAsync<Type>(data: Type): Promise<boolean> {
    // any error thrown by this method shall be sent to the parent...
    let dataAsJson = JsonSerializer.serialize(data, {
      shallDeepSanitize: true,
    });
    dataAsJson = `${dataAsJson}${END_OF_DATA_MARKER}\n`;     // <-- we must add the new-line character...

    // we shall send data to the parent process...
    process.stdout.cork();

    const isSent = process.stdout.write(dataAsJson, "utf-8");

    process.stdout.uncork();

    return isSent;
  }
}
