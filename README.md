# Rilgate SDK

Client libraries for [Rilgate](https://github.com/ViGrise/rilgate), a reverse proxy gateway
that uses proof-of-work challenges.

## Packages

| Package | Directory | Use |
| --- | --- | --- |
| `@rilgate/browser` | [`packages/browser`](packages/browser) | Finds challenges on same-origin requests in a web page and its service worker. Solves each challenge once in a frame and retries the requests. |

Each package README gives its installation steps and API.

## Repository layout

```text
packages/<name>/
  src/          package source
  test/         tests, in the same folder structure as src/
  README.md     package documentation
```

In `packages/browser/src`, the `protocol/` and `core/` folders use no DOM API. The
`typecheck` script checks this with `tsconfig.dom-free.json`. A package for another
runtime can use these folders without a browser.

## Development

The repository is an npm workspace. Node.js 24 or later runs the TypeScript tests
directly.

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Run the lint, type checks, tests and build of every package:

   ```sh
   npm run check
   ```

To add a package, create `packages/<name>` with its own `package.json` that has the
`build`, `typecheck` and `test` scripts. The root scripts run them in each package.

## License

Apache-2.0. See [LICENSE](LICENSE).
