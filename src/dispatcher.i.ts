import { ServiceType } from "@shahadul-17/service-provider";
import { DispatchableTaskInformation } from "./dispatchable-task-information.t";
import { DispatcherOptions } from "./dispatcher-options.t";

export interface IDispatcher {

  /**
   * Returns true if the dispatcher is started.
   * Otherwise retuns false.
   */
  get isStarted(): boolean;

  /**
   * Gets the total number of processes used by this dispatcher.
   */
  get processCount(): number;

  /**
   * Gets the dispatcher options used while creating the dispatcher.
   */
  get options(): DispatcherOptions;

  /**
   * Dispatches a task.
   * @param taskInformation Information of the task to be dispatched.
   */
  dispatchAsync<ServiceClassType, ReturnType>(taskInformation: DispatchableTaskInformation<ServiceClassType, ReturnType>): Promise<ReturnType>;

  /**
   * Retrieves a service.
   * @param serviceType Type of the service class.
   * @param scopeName Name of the scope.
   * @returns The requested service.
   */
  getService<Type>(serviceType: ServiceType<Type>, scopeName?: string): Type;

  /**
   * Starts the dispatcher.
   */
  startAsync(): Promise<void>;

  /**
   * Stops the dispatcher.
   */
  stopAsync(): Promise<void>;
}
