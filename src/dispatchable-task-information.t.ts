import { ServiceScope, ServiceType } from "@shahadul-17/service-provider";

export type DispatchableTaskInformation<ServiceInstanceType, ReturnType> = {
  methodName: string,
  methodArguments?: Array<any>,
  serviceType: ServiceType<ServiceInstanceType>,
  serviceScopeName?: string,
  returnType: ServiceType<ReturnType>,
};
