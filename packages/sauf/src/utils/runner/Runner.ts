
export interface Runner {
  ssrLoadModule(modulePath: string, opts?: any): Promise<any>;
  listen(): Promise<void>;
  close(): Promise<void>;
};
