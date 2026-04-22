# rehype-prerender

A rehype plugin and companion packages that bake client-rendered libraries
(MathJax v2, Prism, Twitter widgets) into static HTML via a headless browser.

## Development

### Bootstrapping a new package

npm requires a package to exist on the registry before you can configure
trusted publishing for it, so each new publishable workspace has to be
bootstrapped once before the normal release flow works. Run
[`azu/setup-npm-trusted-publish`](https://github.com/azu/setup-npm-trusted-publish)
to publish a placeholder at `0.0.1` and register this repo's workflow as
the trusted publisher:

```sh
npx setup-npm-trusted-publish <npm-name> \
  --github.repo u1f992/rehype-prerender \
  --github.file npm-trusted-publishing.yaml \
  --mfa automation
```

The command needs npm ≥ 11.10.0 and either a local `npm login` or an
`NPM_TOKEN` environment variable. A short-lived granular access token
with write access to the target name works; revoke it after the bootstrap.

Because the placeholder occupies `0.0.1`, the first real release of a
workspace has to be `0.0.2` or higher (`0.1.0` is the usual pick).

The currently publishable workspaces are:

- `rehype-prerender`
- `rehype-prerender-mathjax-v2`
- `rehype-prerender-prism`
- `rehype-prerender-twitter`

### Release flow

Each workspace is versioned independently; a release is exactly one workspace
going out to npm on one tag push. The tag scheme mirrors the remark ecosystem:

| Tag | Target |
| --- | --- |
| `<version>` | `packages/rehype-prerender` |
| `<npm-name>@<version>` | the workspace whose `package.json` `name` matches |

Tags are bare (no `v` prefix). Subpackage tags have to be created by hand;
`npm version` does not tag workspace bumps.

Example for bumping `rehype-prerender-prism` to `0.1.0`:

```sh
# edit packages/prism/package.json, set "version": "0.1.0"
git commit -am "Release rehype-prerender-prism 0.1.0"
git tag rehype-prerender-prism@0.1.0
git push origin main rehype-prerender-prism@0.1.0
```

`.github/workflows/npm-trusted-publishing.yaml` fires on the tag push. It
parses the tag into `name` and `version`, builds the monorepo, runs that
workspace's test suite, and publishes only that workspace with
`npm publish --workspace=<name>` under npm OIDC trusted publishing. npm
attaches an SLSA provenance attestation automatically when trusted
publishing is the auth path, so you don't need `--provenance`.

CI does not check that the tag's version matches the target
`package.json`'s `version`; that's the releaser's job. Bump `version`,
commit, then tag that commit, as in the example above.

A subpackage's declared `rehype-prerender` range needs an update when
`rehype-prerender` lands a change that breaks the subpackage's
compatibility. By semver that's a major bump, which also falls outside
the current `"^1.0.0"`. Do it in the same commit as the bump. A stale
range still resolves locally via the workspace symlink, but `npm ci` in
CI tries to fetch the pinned version from the registry and fails before
publish.

`packages/test-helpers` and the repo root are `private: true` and never
get published. Each publishable workspace declares a `repository` field
(with `directory`) pointing at its path in the monorepo; npm's trusted
publisher configuration matches against that URL.
