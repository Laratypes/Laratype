import * as z from 'zod'

/**
 * The one request schema all four apps validate with: Zod 4.6.7, the version the root catalog resolves
 * and the Standard Schema vendor @laratype/contract ships on.
 */
export const userInput = z.object({
  name: z.string().min(1),
  email: z.email(),
})

export const validUser = Object.freeze({ name: 'Ada', email: 'ada@example.com' })

/** The invalid fixture of scenario 3b: a too-short name and a bad email, both derived from the schema above. */
export const invalidUser = Object.freeze({ name: '', email: 'nope' })
