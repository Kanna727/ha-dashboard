# Contributing

Thanks for helping with HA Dashboard. This is a small personal project, so the process is light, but a few rules keep releases and privacy safe.

## Setup

```sh
git clone https://github.com/Kanna727/ha-dashboard.git
cd ha-dashboard
npm install
git config core.hooksPath .githooks   # once per clone: enables the privacy pre-commit hook
npm run mock                          # offline preview with fake data on http://localhost:5173
```

You do not need a Home Assistant instance. The mock (`mock/`) simulates a fictional home, and all screenshots and tests use it.

## Making a change

1. **Branch from `main`**, one branch per change: `feat/short-name`, `fix/short-name`, `docs/short-name`.
2. **Keep it focused.** Small PRs get reviewed faster.
3. **Run the checks locally** before pushing:
   ```sh
   npm run typecheck
   npm test
   npm run build
   ```
4. **Add or update tests** for logic in `src/lib/`. UI changes should be tried in the mock at the tablet, phone and desktop layouts (`?layout=tablet|desktop|phone`).
5. **Update `AGENTS.md`** in the same PR if you change behaviour, architecture, the build or deploy flow, or find a gotcha.
6. **Open a pull request** against `main`. Fill in what changed and how you checked it.

## PR titles and commits

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/); CI checks this, and the title becomes the squash-merge commit that drives releases:

- `feat: ...` new feature (minor release)
- `fix: ...` bug fix (patch release)
- `perf:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:` (no release, except `perf`)
- Add `!` or a `BREAKING CHANGE:` footer for breaking changes.

Releases are automatic: every merge to `main` runs semantic-release, which tags a version, updates `CHANGELOG.md` and publishes a release. Do not edit `CHANGELOG.md` or bump versions by hand.

## Visual tests

CI compares screenshots in `tests/visual/__screenshots__`. If you changed the look on purpose, ask a maintainer to add the `update-baselines` label to your PR, which regenerates them on Linux. Don't commit baselines made on Windows or macOS.

## Privacy: the important rule

This repo is public. **Never commit anything personal**: real names, emails, addresses, coordinates, IP addresses, device serials or MAC addresses, account or bank details, API keys, tokens, webhook IDs, or entity IDs from a real home.

- Real configuration lives in `config/dashboard.config.ts`, which is gitignored. `config/dashboard.config.example.ts` is the committed template.
- Tests, mocks and docs must use fictional values (for example MACs starting `02:00:5e`, names like Alex and Sam).
- The same goes for **PR descriptions, comments and commit messages**: they are public too, and the privacy check does not scan them.
- `scripts/privacy-check.sh` runs as a pre-commit hook and in CI against a private pattern list. Passing it is not proof the change is safe, so review your own diff.

## Third-party assets

3D models (for example from Sketchfab) are licensed for use, not redistribution. Never commit `.glb` or `.gltf` files; see `AGENTS.md` for how the car model is kept out of git.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
