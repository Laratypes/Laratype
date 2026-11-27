---
"@laratype/contract": patch
---

H33 #313: isContractError requires a plain-object body, so a Map, Set, Date or class-instance body is not a contract error and answers the generic 500 instead of an emptied body.
