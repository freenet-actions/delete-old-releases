# Delete old releases

This action searches for GitHub releases matching a specific prefix or regex and removes all that exceed a certain age.

## Usage

```yaml
- uses: freenet-actions/delete-old-releases@v1
  with:
    prefix: 'develop-'  # Delete all releases starting with "develop-".
    max-age: 'P1W'      # Delete all releases older than one week.
    token: '${{ github.token }}'
```

With the `keep-latest-releases` option:
```yaml
- uses: freenet-actions/delete-old-releases@v1
  with:
    regex: '^(?<group>.*)-\d$'  # Delete any and all releases. Capture part of the release name for the keep-latest-releases option.
    max-age: 'P1W'              # Delete all releases older than one week.
    keep-latest-releases: true   # Keep the latest release per group (e.g. develop-1, develop-2, etc.).
    token: '${{ github.token }}'
```

### Inputs

| Name                   | Required | Default | Description                                                                                                                                                                                                                                                  |
|------------------------|----------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `token`                | `true`   | None    | The GitHub token.                                                                                                                                                                                                                                            |
| `prefix`               | `false`  | None    | If given, release names must match the given prefix to be considered for deletion.                                                                                                                                                                           |
| `regex`                | `false`  | None    | If given, release names must match the given regex to be considered for deletion.                                                                                                                                                                            |
| `max-age`              | `true`   | `P1W`   | The minimum age a release must have (published date or, if not given, creation date) to be considered for deletion. Format: [ISO 8601 duration](https://www.digi.com/resources/documentation/digidocs/90001488-13/reference/r_iso_8601_duration_format.htm). |
| `delete-tags`          | `false`  | `false` | Delete the releases' tags?                                                                                                                                                                                                                                   |
| `keep-latest-releases` | `false`  | `false` | Keep the latest release (per group). If set to `true`, you must provide the regex input with a named capture group "group".                                                                                                                                  |
| `dry-run`              | `false`  | `false` | Do not remove any releases, only log their names.                                                                                                                                                                                                            |

If you specify neither `prefix` nor `regex`, all releases that match the `max-age` criteria are deleted.

## Notes
Draft releases are ignored: They are neither deleted nor considered for the `keep-latest-releases` feature.

## Development

When making changes, make sure you run `npm ci --omit=dev` before commiting your changes. The production dependencies need to be commited for the action to be called, but the dev dependencies do not.
