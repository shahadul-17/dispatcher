import { ServiceType } from "@shahadul-17/service-provider";

export type DispatchableTaskInformation = {
  methodName: string,
  methodArguments: Array<any>,
  serviceType: ServiceType<any>,
};
