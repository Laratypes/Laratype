import { Serve } from "laratype";

globalThis.__PROD__ = false;

export default Serve.create();