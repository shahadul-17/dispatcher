import { IServiceProvider } from "@shahadul-17/service-provider";

export interface IDispatcherServiceInitializer {
  initializeAsync(serviceProvider: IServiceProvider): Promise<void>;
}
