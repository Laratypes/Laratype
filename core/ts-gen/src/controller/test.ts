import UserController from "../../../../src/controllers/UserController"

const user = new UserController()
const res = user.store()
export default res;