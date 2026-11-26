// H14 #163 fixture: a contract whose `:user` param names the model file `app/models/User.ts`.
import { defineContract, endpoint } from '@laratype/contract'

export default defineContract()({
  show: endpoint.get('/:user'),
})
