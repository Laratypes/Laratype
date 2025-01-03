
export default class DriverNotImplement {

  constructor() {
    throw {
      code: "DRIVER_NOT_IMPLEMENT",
      message: "Driver not implemented",
      httpCode: 500,
      responsible: true,
      reportable: false,
    };
  };
}