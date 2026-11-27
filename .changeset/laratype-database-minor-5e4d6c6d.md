---
"@laratype/database": minor
---

Hash every password written through Model.save(), update() and updateFor() with Hash.makeAsync(), including hash-shaped input; keep a Hash.trusted() value as-is; refuse the credential column in the array and nested forms of findOneBy().
