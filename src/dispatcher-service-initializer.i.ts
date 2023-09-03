import { IServiceProvider } from "@shahadul-17/service-provider";

export interface IDispatcherServiceInitializer {
  initializeAsync(processId: number, serviceProvider: IServiceProvider): Promise<void>;
}
