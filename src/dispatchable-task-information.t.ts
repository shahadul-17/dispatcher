import { ServiceType } from "@shahadul-17/service-provider";

export type DispatchableTaskInformation<ServiceClassType, ReturnType> = {
  methodName: string,
  methodArguments: Array<any>,
  serviceType: ServiceType<ServiceClassType>,
  returnType: ServiceType<ReturnType>,
};
