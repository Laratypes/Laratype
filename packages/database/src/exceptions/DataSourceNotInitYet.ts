
export default class DataSourceNotInitYet {

  constructor() {
    throw {
      code: "DATASOURCE_NOT_INIT_YET",
      message: "DataSource is not initialized yet. Please make sure the DatabaseServiceProvider is properly configured and the connection is established before accessing the DataSource.",
      httpCode: 500,
      responsible: true,
      reportable: true,
    };
  };
}