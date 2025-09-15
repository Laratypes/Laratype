import type { CockroachConnectionOptions } from "typeorm/driver/cockroachdb/CockroachConnectionOptions";
import type { MysqlConnectionOptions } from "typeorm/driver/mysql/MysqlConnectionOptions";
import type { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import type { SqliteConnectionOptions } from "typeorm/driver/sqlite/SqliteConnectionOptions";
import type { SqlServerConnectionOptions } from "typeorm/driver/sqlserver/SqlServerConnectionOptions";
import type { OracleConnectionOptions } from "typeorm/driver/oracle/OracleConnectionOptions";
import type { MongoConnectionOptions } from "typeorm/driver/mongodb/MongoConnectionOptions";
import type { CordovaConnectionOptions } from "typeorm/driver/cordova/CordovaConnectionOptions";
import type { ReactNativeConnectionOptions } from "typeorm/driver/react-native/ReactNativeConnectionOptions";
import type { NativescriptConnectionOptions } from "typeorm/driver/nativescript/NativescriptConnectionOptions";
import type { ExpoConnectionOptions } from "typeorm/driver/expo/ExpoConnectionOptions";
import type { SapConnectionOptions } from "typeorm/driver/sap/SapConnectionOptions";
import type { SpannerConnectionOptions } from "typeorm/driver/spanner/SpannerConnectionOptions";
import type { Strategy } from "passport"
import { O } from "ts-toolbelt"

export namespace LaratypeConfig {
  export interface AppConfig {
    readonly name: string
    readonly env: string
    readonly debug: boolean
    readonly url: string
    readonly timezone: string
    readonly schedule_timezone: string
    readonly locale: string
    readonly fallback_locale: string
    readonly key: string | null
    readonly cipher: string
    readonly logging?: Logging.Config
    readonly database?: Database.Config
  }

  export namespace Logging {
    export type CHANNEL = "stack" | "single" | "daily"
    export interface Config {
      default: CHANNEL,
      channels: {
        stack: {
          readonly driver: "stack",
          readonly channel: string[],
        },
        single: {
          readonly driver: "single",
          readonly level: string,
        },
        daily: {
          readonly driver: 'daily',
          readonly level: string,
          readonly days: number,
        }
      }
    }
  }

  export namespace Database {
    export type DRIVER = 
        | "mysql"
        | "mariadb"
        | "postgres"
        | "cockroachdb"
        | "sqlite"
        | "mssql"
        | "sap"
        | "spanner"
        | "oracle"
        | "mongodb"
        | "cordova"
        | "react-native"
        | "expo"
        | "nativescript"
    export interface Config {
      readonly default: DRIVER
      connections: O.AtLeast<{
        mysql: MysqlConnectionOptions
        mariadb: MysqlConnectionOptions
        postgres: PostgresConnectionOptions
        cockroachdb: CockroachConnectionOptions
        sqlite: SqliteConnectionOptions
        mssql: SqlServerConnectionOptions
        sap: SapConnectionOptions
        spanner: SpannerConnectionOptions
        oracle: OracleConnectionOptions
        mongodb: MongoConnectionOptions
        cordova: CordovaConnectionOptions
        "react-native": ReactNativeConnectionOptions
        expo: ExpoConnectionOptions
        nativescript: NativescriptConnectionOptions
      }>
    }
  }

  type AuthGuard = {
    readonly strategy: typeof Strategy
    readonly strategyName: string
    readonly options: Record<string, any>
    provider: any
  }

  type GuardType = "guard"

  export interface Auth {
    default: Record<GuardType, string>,
    guards: Record<string, AuthGuard>
  }

}