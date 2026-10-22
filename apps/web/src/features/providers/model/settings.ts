export type AIStatus = {
  providers: {
    id: string;
    name: string;
    configured: boolean;
    models: string[];
    model: string;
    tokenWarning: number;
    dashboard: string;
  }[];
  validation?: { level: "metadata"; inferenceVerified: false; notice: string };
  configured: boolean;
  encryptionReady: boolean;
  provider: string;
  model: string;
  models: string[];
  tokenWarning: number;
  usage: { input: number; output: number; cost: null; period: string };
  warning: boolean;
};
