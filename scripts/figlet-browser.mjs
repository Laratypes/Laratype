// figlet's Node entry sets its font path from `__dirname`, which Bun folds into the build machine's
// `node_modules/figlet/dist`. sauf's resources bundles are copied into an app's dist, where neither that
// path nor figlet's own `fonts/` folder exists (B25 #329). The browser entry reads no files, so this
// registers the Standard font the banner uses and the bundle carries the font data instead.
// `packages/sauf/build.config.js` resolves `figlet` here for the resources builds only; package dists
// keep figlet external, as a declared dependency.
import figlet from "figlet/browser"
import Standard from "figlet/importable-fonts/Standard.js"

figlet.parseFont("Standard", Standard)

export default figlet
