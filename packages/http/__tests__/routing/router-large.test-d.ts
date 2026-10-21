// Type tests for long Route.api lists (H1 #104 review): 62 contracts still check missing and duplicate contracts.
// Generated shape; run by `bunx vitest run --project types`.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { test } from 'vitest'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route } from '../../src/index'

// One controller for every contract: a handler for each e<n> endpoint (the route proof needs one per endpoint)
const Ctrl = Controller as unknown as new () => Record<`e${number}`, () => void>
const c0 = defineContract()({ e0: endpoint.get('/') })
const c1 = defineContract()({ e1: endpoint.get('/') })
const c2 = defineContract()({ e2: endpoint.get('/') })
const c3 = defineContract()({ e3: endpoint.get('/') })
const c4 = defineContract()({ e4: endpoint.get('/') })
const c5 = defineContract()({ e5: endpoint.get('/') })
const c6 = defineContract()({ e6: endpoint.get('/') })
const c7 = defineContract()({ e7: endpoint.get('/') })
const c8 = defineContract()({ e8: endpoint.get('/') })
const c9 = defineContract()({ e9: endpoint.get('/') })
const c10 = defineContract()({ e10: endpoint.get('/') })
const c11 = defineContract()({ e11: endpoint.get('/') })
const c12 = defineContract()({ e12: endpoint.get('/') })
const c13 = defineContract()({ e13: endpoint.get('/') })
const c14 = defineContract()({ e14: endpoint.get('/') })
const c15 = defineContract()({ e15: endpoint.get('/') })
const c16 = defineContract()({ e16: endpoint.get('/') })
const c17 = defineContract()({ e17: endpoint.get('/') })
const c18 = defineContract()({ e18: endpoint.get('/') })
const c19 = defineContract()({ e19: endpoint.get('/') })
const c20 = defineContract()({ e20: endpoint.get('/') })
const c21 = defineContract()({ e21: endpoint.get('/') })
const c22 = defineContract()({ e22: endpoint.get('/') })
const c23 = defineContract()({ e23: endpoint.get('/') })
const c24 = defineContract()({ e24: endpoint.get('/') })
const c25 = defineContract()({ e25: endpoint.get('/') })
const c26 = defineContract()({ e26: endpoint.get('/') })
const c27 = defineContract()({ e27: endpoint.get('/') })
const c28 = defineContract()({ e28: endpoint.get('/') })
const c29 = defineContract()({ e29: endpoint.get('/') })
const c30 = defineContract()({ e30: endpoint.get('/') })
const c31 = defineContract()({ e31: endpoint.get('/') })
const c32 = defineContract()({ e32: endpoint.get('/') })
const c33 = defineContract()({ e33: endpoint.get('/') })
const c34 = defineContract()({ e34: endpoint.get('/') })
const c35 = defineContract()({ e35: endpoint.get('/') })
const c36 = defineContract()({ e36: endpoint.get('/') })
const c37 = defineContract()({ e37: endpoint.get('/') })
const c38 = defineContract()({ e38: endpoint.get('/') })
const c39 = defineContract()({ e39: endpoint.get('/') })
const c40 = defineContract()({ e40: endpoint.get('/') })
const c41 = defineContract()({ e41: endpoint.get('/') })
const c42 = defineContract()({ e42: endpoint.get('/') })
const c43 = defineContract()({ e43: endpoint.get('/') })
const c44 = defineContract()({ e44: endpoint.get('/') })
const c45 = defineContract()({ e45: endpoint.get('/') })
const c46 = defineContract()({ e46: endpoint.get('/') })
const c47 = defineContract()({ e47: endpoint.get('/') })
const c48 = defineContract()({ e48: endpoint.get('/') })
const c49 = defineContract()({ e49: endpoint.get('/') })
const c50 = defineContract()({ e50: endpoint.get('/') })
const c51 = defineContract()({ e51: endpoint.get('/') })
const c52 = defineContract()({ e52: endpoint.get('/') })
const c53 = defineContract()({ e53: endpoint.get('/') })
const c54 = defineContract()({ e54: endpoint.get('/') })
const c55 = defineContract()({ e55: endpoint.get('/') })
const c56 = defineContract()({ e56: endpoint.get('/') })
const c57 = defineContract()({ e57: endpoint.get('/') })
const c58 = defineContract()({ e58: endpoint.get('/') })
const c59 = defineContract()({ e59: endpoint.get('/') })
const c60 = defineContract()({ e60: endpoint.get('/') })
const c61 = defineContract()({ e61: endpoint.get('/') })
const appApi = defineApi({
  n0: { contract: c0, path: '/n0', scopes: [], dirs: [] },
  n1: { contract: c1, path: '/n1', scopes: [], dirs: [] },
  n2: { contract: c2, path: '/n2', scopes: [], dirs: [] },
  n3: { contract: c3, path: '/n3', scopes: [], dirs: [] },
  n4: { contract: c4, path: '/n4', scopes: [], dirs: [] },
  n5: { contract: c5, path: '/n5', scopes: [], dirs: [] },
  n6: { contract: c6, path: '/n6', scopes: [], dirs: [] },
  n7: { contract: c7, path: '/n7', scopes: [], dirs: [] },
  n8: { contract: c8, path: '/n8', scopes: [], dirs: [] },
  n9: { contract: c9, path: '/n9', scopes: [], dirs: [] },
  n10: { contract: c10, path: '/n10', scopes: [], dirs: [] },
  n11: { contract: c11, path: '/n11', scopes: [], dirs: [] },
  n12: { contract: c12, path: '/n12', scopes: [], dirs: [] },
  n13: { contract: c13, path: '/n13', scopes: [], dirs: [] },
  n14: { contract: c14, path: '/n14', scopes: [], dirs: [] },
  n15: { contract: c15, path: '/n15', scopes: [], dirs: [] },
  n16: { contract: c16, path: '/n16', scopes: [], dirs: [] },
  n17: { contract: c17, path: '/n17', scopes: [], dirs: [] },
  n18: { contract: c18, path: '/n18', scopes: [], dirs: [] },
  n19: { contract: c19, path: '/n19', scopes: [], dirs: [] },
  n20: { contract: c20, path: '/n20', scopes: [], dirs: [] },
  n21: { contract: c21, path: '/n21', scopes: [], dirs: [] },
  n22: { contract: c22, path: '/n22', scopes: [], dirs: [] },
  n23: { contract: c23, path: '/n23', scopes: [], dirs: [] },
  n24: { contract: c24, path: '/n24', scopes: [], dirs: [] },
  n25: { contract: c25, path: '/n25', scopes: [], dirs: [] },
  n26: { contract: c26, path: '/n26', scopes: [], dirs: [] },
  n27: { contract: c27, path: '/n27', scopes: [], dirs: [] },
  n28: { contract: c28, path: '/n28', scopes: [], dirs: [] },
  n29: { contract: c29, path: '/n29', scopes: [], dirs: [] },
  n30: { contract: c30, path: '/n30', scopes: [], dirs: [] },
  n31: { contract: c31, path: '/n31', scopes: [], dirs: [] },
  n32: { contract: c32, path: '/n32', scopes: [], dirs: [] },
  n33: { contract: c33, path: '/n33', scopes: [], dirs: [] },
  n34: { contract: c34, path: '/n34', scopes: [], dirs: [] },
  n35: { contract: c35, path: '/n35', scopes: [], dirs: [] },
  n36: { contract: c36, path: '/n36', scopes: [], dirs: [] },
  n37: { contract: c37, path: '/n37', scopes: [], dirs: [] },
  n38: { contract: c38, path: '/n38', scopes: [], dirs: [] },
  n39: { contract: c39, path: '/n39', scopes: [], dirs: [] },
  n40: { contract: c40, path: '/n40', scopes: [], dirs: [] },
  n41: { contract: c41, path: '/n41', scopes: [], dirs: [] },
  n42: { contract: c42, path: '/n42', scopes: [], dirs: [] },
  n43: { contract: c43, path: '/n43', scopes: [], dirs: [] },
  n44: { contract: c44, path: '/n44', scopes: [], dirs: [] },
  n45: { contract: c45, path: '/n45', scopes: [], dirs: [] },
  n46: { contract: c46, path: '/n46', scopes: [], dirs: [] },
  n47: { contract: c47, path: '/n47', scopes: [], dirs: [] },
  n48: { contract: c48, path: '/n48', scopes: [], dirs: [] },
  n49: { contract: c49, path: '/n49', scopes: [], dirs: [] },
  n50: { contract: c50, path: '/n50', scopes: [], dirs: [] },
  n51: { contract: c51, path: '/n51', scopes: [], dirs: [] },
  n52: { contract: c52, path: '/n52', scopes: [], dirs: [] },
  n53: { contract: c53, path: '/n53', scopes: [], dirs: [] },
  n54: { contract: c54, path: '/n54', scopes: [], dirs: [] },
  n55: { contract: c55, path: '/n55', scopes: [], dirs: [] },
  n56: { contract: c56, path: '/n56', scopes: [], dirs: [] },
  n57: { contract: c57, path: '/n57', scopes: [], dirs: [] },
  n58: { contract: c58, path: '/n58', scopes: [], dirs: [] },
  n59: { contract: c59, path: '/n59', scopes: [], dirs: [] },
  n60: { contract: c60, path: '/n60', scopes: [], dirs: [] },
  n61: { contract: c61, path: '/n61', scopes: [], dirs: [] },
})

test('every contract mounted once compiles', () => {
  Route.api(appApi, (r) => [r.contract(c0, Ctrl), r.contract(c1, Ctrl), r.contract(c2, Ctrl), r.contract(c3, Ctrl), r.contract(c4, Ctrl), r.contract(c5, Ctrl), r.contract(c6, Ctrl), r.contract(c7, Ctrl), r.contract(c8, Ctrl), r.contract(c9, Ctrl), r.contract(c10, Ctrl), r.contract(c11, Ctrl), r.contract(c12, Ctrl), r.contract(c13, Ctrl), r.contract(c14, Ctrl), r.contract(c15, Ctrl), r.contract(c16, Ctrl), r.contract(c17, Ctrl), r.contract(c18, Ctrl), r.contract(c19, Ctrl), r.contract(c20, Ctrl), r.contract(c21, Ctrl), r.contract(c22, Ctrl), r.contract(c23, Ctrl), r.contract(c24, Ctrl), r.contract(c25, Ctrl), r.contract(c26, Ctrl), r.contract(c27, Ctrl), r.contract(c28, Ctrl), r.contract(c29, Ctrl), r.contract(c30, Ctrl), r.contract(c31, Ctrl), r.contract(c32, Ctrl), r.contract(c33, Ctrl), r.contract(c34, Ctrl), r.contract(c35, Ctrl), r.contract(c36, Ctrl), r.contract(c37, Ctrl), r.contract(c38, Ctrl), r.contract(c39, Ctrl), r.contract(c40, Ctrl), r.contract(c41, Ctrl), r.contract(c42, Ctrl), r.contract(c43, Ctrl), r.contract(c44, Ctrl), r.contract(c45, Ctrl), r.contract(c46, Ctrl), r.contract(c47, Ctrl), r.contract(c48, Ctrl), r.contract(c49, Ctrl), r.contract(c50, Ctrl), r.contract(c51, Ctrl), r.contract(c52, Ctrl), r.contract(c53, Ctrl), r.contract(c54, Ctrl), r.contract(c55, Ctrl), r.contract(c56, Ctrl), r.contract(c57, Ctrl), r.contract(c58, Ctrl), r.contract(c59, Ctrl), r.contract(c60, Ctrl), r.contract(c61, Ctrl)])
})
test('a missing contract is still an error', () => {
  // @ts-expect-error Route.api: contract "n61" is not mounted (add r.contract())
  Route.api(appApi, (r) => [r.contract(c0, Ctrl), r.contract(c1, Ctrl), r.contract(c2, Ctrl), r.contract(c3, Ctrl), r.contract(c4, Ctrl), r.contract(c5, Ctrl), r.contract(c6, Ctrl), r.contract(c7, Ctrl), r.contract(c8, Ctrl), r.contract(c9, Ctrl), r.contract(c10, Ctrl), r.contract(c11, Ctrl), r.contract(c12, Ctrl), r.contract(c13, Ctrl), r.contract(c14, Ctrl), r.contract(c15, Ctrl), r.contract(c16, Ctrl), r.contract(c17, Ctrl), r.contract(c18, Ctrl), r.contract(c19, Ctrl), r.contract(c20, Ctrl), r.contract(c21, Ctrl), r.contract(c22, Ctrl), r.contract(c23, Ctrl), r.contract(c24, Ctrl), r.contract(c25, Ctrl), r.contract(c26, Ctrl), r.contract(c27, Ctrl), r.contract(c28, Ctrl), r.contract(c29, Ctrl), r.contract(c30, Ctrl), r.contract(c31, Ctrl), r.contract(c32, Ctrl), r.contract(c33, Ctrl), r.contract(c34, Ctrl), r.contract(c35, Ctrl), r.contract(c36, Ctrl), r.contract(c37, Ctrl), r.contract(c38, Ctrl), r.contract(c39, Ctrl), r.contract(c40, Ctrl), r.contract(c41, Ctrl), r.contract(c42, Ctrl), r.contract(c43, Ctrl), r.contract(c44, Ctrl), r.contract(c45, Ctrl), r.contract(c46, Ctrl), r.contract(c47, Ctrl), r.contract(c48, Ctrl), r.contract(c49, Ctrl), r.contract(c50, Ctrl), r.contract(c51, Ctrl), r.contract(c52, Ctrl), r.contract(c53, Ctrl), r.contract(c54, Ctrl), r.contract(c55, Ctrl), r.contract(c56, Ctrl), r.contract(c57, Ctrl), r.contract(c58, Ctrl), r.contract(c59, Ctrl), r.contract(c60, Ctrl)])
})
test('a duplicate contract is still an error', () => {
  // @ts-expect-error Route.api: contract "n0" is mounted twice
  Route.api(appApi, (r) => [r.contract(c0, Ctrl), r.contract(c1, Ctrl), r.contract(c2, Ctrl), r.contract(c3, Ctrl), r.contract(c4, Ctrl), r.contract(c5, Ctrl), r.contract(c6, Ctrl), r.contract(c7, Ctrl), r.contract(c8, Ctrl), r.contract(c9, Ctrl), r.contract(c10, Ctrl), r.contract(c11, Ctrl), r.contract(c12, Ctrl), r.contract(c13, Ctrl), r.contract(c14, Ctrl), r.contract(c15, Ctrl), r.contract(c16, Ctrl), r.contract(c17, Ctrl), r.contract(c18, Ctrl), r.contract(c19, Ctrl), r.contract(c20, Ctrl), r.contract(c21, Ctrl), r.contract(c22, Ctrl), r.contract(c23, Ctrl), r.contract(c24, Ctrl), r.contract(c25, Ctrl), r.contract(c26, Ctrl), r.contract(c27, Ctrl), r.contract(c28, Ctrl), r.contract(c29, Ctrl), r.contract(c30, Ctrl), r.contract(c31, Ctrl), r.contract(c32, Ctrl), r.contract(c33, Ctrl), r.contract(c34, Ctrl), r.contract(c35, Ctrl), r.contract(c36, Ctrl), r.contract(c37, Ctrl), r.contract(c38, Ctrl), r.contract(c39, Ctrl), r.contract(c40, Ctrl), r.contract(c41, Ctrl), r.contract(c42, Ctrl), r.contract(c43, Ctrl), r.contract(c44, Ctrl), r.contract(c45, Ctrl), r.contract(c46, Ctrl), r.contract(c47, Ctrl), r.contract(c48, Ctrl), r.contract(c49, Ctrl), r.contract(c50, Ctrl), r.contract(c51, Ctrl), r.contract(c52, Ctrl), r.contract(c53, Ctrl), r.contract(c54, Ctrl), r.contract(c55, Ctrl), r.contract(c56, Ctrl), r.contract(c57, Ctrl), r.contract(c58, Ctrl), r.contract(c59, Ctrl), r.contract(c60, Ctrl), r.contract(c61, Ctrl), r.contract(c0, Ctrl)])
})
