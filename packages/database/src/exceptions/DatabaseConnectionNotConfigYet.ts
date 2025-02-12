
export default class DatabaseConnectionNotConfigYet {

  constructor() {
    throw {
      code: "DATABASE_CONNECTION_NOT_CONFIG_YET",
      message: "Database connection not configured",
      httpCode: 500,
      responsible: true,
      reportable: true,
    };
  };
}