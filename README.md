# `fetch-itch-games`

This project allows you to download all of the games on [itch.io](https://itch.io) associated with a provided API key.
This can be useful for creating a backup of the files you've uploaded to itch for your own storage or for porting to another platform.

Files downloaded will include each available build for the game, two image files (`cover` and `still_cover`), a `metadata.json` describing the game. The root folder will also include a `metadata.json` describing all of the games in a list.

Dependencies:

- [butler](https://itch.io/docs/butler/installing.html)
- an [itch.io API key](https://itch.io/user/settings/api-keys) for your account

## Usage

```sh
npx fetch-itch-games -o output [--dry-run]
```

## Examples

```sh
# Download all your games to a folder named "games"
API_KEY=abcd1234 npx fetch-itch-games -o games

# List what files would be downloaded without actually downloading them
API_KEY=abcd1234 npx fetch-itch-games -o . --dry-run
```
