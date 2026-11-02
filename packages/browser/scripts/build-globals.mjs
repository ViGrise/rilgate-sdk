// Builds the classic-script bundles: one for a page `<script>` tag and one for
// `importScripts()` in a service worker that is not bundled.
import { build } from "esbuild";

for (const name of ["rilgate-browser", "rilgate-service-worker"]) {
  await build({
    entryPoints: [`src/globals/${name}.global.ts`],
    outfile: `dist/${name}.global.js`,
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: true,
    legalComments: "none",
  });
}
