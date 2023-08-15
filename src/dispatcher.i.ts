import { DispatchableTaskInformation } from "./dispatchable-task-information.t";

export interface IDispatcher {

  /**
   * Returns true if the dispatcher is started.
   * Otherwise retuns false.
   */
  isStarted(): boolean;

  /**
   * Gets the total number of processes used by this dispatcher.
   */
  getProcessCount(): number;

  /**
   * Gets the total number of threads used by each process of this dispatcher.
   */
  getThreadCountPerProcess(): number;

  /**
   * Dispatches a task.
   * @param taskInformation Task information to be dispatched.
   */
  dispatchAsync<ServiceClassType, ReturnType>(taskInformation: DispatchableTaskInformation<ServiceClassType, ReturnType>): Promise<ReturnType>;

  /**
   * Starts the dispatcher.
   */
  startAsync(): Promise<void>;

  /**
   * Stops the dispatcher.
   */
  stopAsync(): Promise<void>;
}
