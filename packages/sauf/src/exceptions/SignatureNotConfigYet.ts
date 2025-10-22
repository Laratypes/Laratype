
export default class SignatureNotConfigYet {

  constructor() {
    throw {
      code: "COMMAND_SIGNATURE_NOT_CONFIG_YET",
      message: "Command signature not configured yet",
      httpCode: 500,
      responsible: true,
      reportable: false,
    };
  };
}