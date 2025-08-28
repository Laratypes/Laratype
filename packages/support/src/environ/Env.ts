/// <reference path="../../env.d.ts" />

export default class Env {

  public static get<T extends keyof EnvVariables, D>(key: T, defaultVal: D) {
    return (process.env)[key] || defaultVal;
  }
}