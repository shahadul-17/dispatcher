import { DispatchableTaskInformation } from "./dispatchable-task-information.t";

export interface IDispatcher {

  /**
   * Returns true if the dispatcher is started.
   * Otherwise retuns false.
   */
  isStarted(): boolean;

  /**
   * Gets the total number of threads used by this dispatcher.
   */
  getThreadCount(): number;

  /**
   * Dispatches a task.
   * @param taskInformation Task information to be dispatched.
   */
  dispatchAsync(taskInformation: DispatchableTaskInformation): Promise<any>;

  /**
   * Starts the dispatcher.
   */
  startAsync(): Promise<void>;

  /**
   * Stops the dispatcher.
   */
  stopAsync(): Promise<void>;
}
